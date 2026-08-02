"""
知拾 局域网 HTTPS 证书生成
- 生成一个本地 CA（ca.crt / ca.key）与服务器证书（server.crt / server.key）
- 证书 SAN 包含本机局域网 IP（可传参指定），供平板通过 https://<IP>:8765 访问
- 每台平板只需安装一次 ca.crt，之后 https 无告警，PWA 可正常安装并全屏运行

用法:
    python make_cert.py                    # 自动检测局域网 IP
    python make_cert.py 192.168.1.100      # 指定 IP
    python make_cert.py 192.168.1.100 10.0.0.5   # 多个 IP
"""

import datetime
import ipaddress
import socket
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

CERTS_DIR = Path(__file__).resolve().parent / "certs"
CA_CERT, CA_KEY = CERTS_DIR / "ca.crt", CERTS_DIR / "ca.key"
SERVER_CERT, SERVER_KEY = CERTS_DIR / "server.crt", CERTS_DIR / "server.key"


def detect_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith("127."):
                return ip
    except OSError:
        pass
    return "127.0.0.1"


def load_cert(path):
    return x509.load_pem_x509_certificate(path.read_bytes())


def load_key(path):
    return serialization.load_pem_private_key(path.read_bytes(), password=None)


def generate_ca():
    if CA_CERT.is_file() and CA_KEY.is_file():
        print(f"[证书] 已有 CA，复用: {CA_CERT}")
        return load_cert(CA_CERT), load_key(CA_KEY)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Zhishi Local CA")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365 * 10))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    CA_CERT.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    CA_KEY.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    print(f"[证书] 已生成本地 CA: {CA_CERT}")
    return cert, key


def generate_server_cert(ips, ca_cert, ca_key):
    san = [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]
    san.append(x509.IPAddress(ipaddress.ip_address("127.0.0.1")))
    san.append(x509.DNSName("localhost"))

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, f"zhishi-{ips[0]}")]
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365 * 2))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .sign(ca_key, hashes.SHA256())
    )
    SERVER_CERT.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    SERVER_KEY.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    print(f"[证书] 已生成服务器证书: {SERVER_CERT}")


def cert_has_ips(path, ips):
    """判断已有服务器证书的 SAN 是否已覆盖这些 IP。"""
    if not path.is_file():
        return False
    cert = load_cert(path)
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except x509.ExtensionNotFound:
        return False
    cert_ips = {str(g.value) for g in san if isinstance(g, x509.IPAddress)}
    return set(ips) <= cert_ips


def ensure_cert(ips=None):
    """确保服务器证书覆盖当前 IP；IP 变化或证书缺失时自动重新签发（CA 不变）。"""
    if not ips:
        ips = [detect_lan_ip()]

    valid = []
    for ip in ips:
        try:
            ipaddress.ip_address(ip)
            valid.append(ip)
        except ValueError:
            print(f"[警告] 忽略无效 IP: {ip}")
    if not valid:
        print("[错误] 没有可用的 IP，请手动指定: python make_cert.py <IP>")
        return []

    CERTS_DIR.mkdir(parents=True, exist_ok=True)
    ca_cert, ca_key = generate_ca()

    if cert_has_ips(SERVER_CERT, valid):
        print(f"[证书] 服务器证书已匹配当前 IP（{', '.join(valid)}），无需重新生成")
        return valid

    if valid == ["127.0.0.1"] and SERVER_CERT.is_file():
        # 未能检测到局域网 IP（可能是回环兜底），不要覆盖已有证书
        print("[证书] 未检测到局域网 IP，保留现有证书；可手动指定: python make_cert.py <IP>")
        return valid

    print(f"[证书] 服务器 IP 变化或证书缺失，重新签发服务器证书（{', '.join(valid)}）...")
    generate_server_cert(valid, ca_cert, ca_key)
    return valid


def main():
    ips = ensure_cert([a.strip() for a in sys.argv[1:] if a.strip()])
    if not ips:
        sys.exit(1)

    print("\n========== 证书已就绪 ==========")
    print(f"  CA:         {CA_CERT}")
    print(f"  服务器证书:  {SERVER_CERT}")
    print(f"  HTTPS 地址: https://{ips[0]}:8765")
    print("\n[平板一次性安装] 用平板浏览器打开下面地址下载并安装 CA（设为受信任凭据）:")
    print(f"  https://{ips[0]}:8765/ca.crt")
    print("  或把 ca.crt 拷贝到平板，在 设置→安全→安装证书(CA证书) 中安装。")
    print("  安装后访问 https 无告警，可正常安装 PWA 全屏运行。")
    print("\n[注意] 服务器 IP 变化时，后端启动会自动重新签发服务器证书（CA 不变，平板无需重装）")


if __name__ == "__main__":
    main()
