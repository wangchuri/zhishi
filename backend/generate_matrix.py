"""生成 logic_matrix.npy — 教育知识体系先修关系矩阵

用法：
    python generate_matrix.py                          # 使用内置 7 技能示例
    python generate_matrix.py --csv skills.csv         # 从 CSV 导入
    python generate_matrix.py --csv skills.csv -o my_matrix.npy  # 输出到指定路径
    python generate_matrix.py --template > skills_template.csv    # 导出 CSV 模板

CSV 格式 (无表头):
    先修技能名称, 后继技能名称
    加法, 乘法
    加法, 方程
    乘法, 方程
"""
import sys
import numpy as np
from pathlib import Path


# 内置 7 技能数学示例
DEFAULT_SKILLS = ["加法", "减法", "乘法", "除法", "一元一次方程", "函数基础", "微积分入门"]
DEFAULT_EDGES = [
    ("加法", "乘法"), ("加法", "除法"), ("加法", "一元一次方程"),
    ("减法", "乘法"), ("减法", "一元一次方程"),
    ("乘法", "一元一次方程"), ("乘法", "函数基础"),
    ("除法", "函数基础"),
    ("一元一次方程", "函数基础"), ("一元一次方程", "微积分入门"),
    ("函数基础", "微积分入门"),
]


def _detect_encoding(file_path: str) -> str:
    """自动检测文件编码（兼容 UTF-8 / UTF-16 / GBK）"""
    with open(file_path, "rb") as f:
        raw = f.read(4)
    if raw[:2] == b'\xff\xfe':
        return "utf-16-le"
    if raw[:2] == b'\xfe\xff':
        return "utf-16-be"
    if raw[:3] == b'\xef\xbb\xbf':
        return "utf-8-sig"
    return "utf-8"


def load_from_csv(csv_path: str) -> tuple[list[str], list[tuple[str, str]]]:
    """从 CSV 加载知识点和先修边（无表头，两列: 先修, 后继）
    自动检测编码：UTF-8 / UTF-16 LE (Excel) / UTF-16 BE
    """
    import csv
    skills_set = set()
    edges = []
    enc = _detect_encoding(csv_path)
    print(f"  [编码检测] {enc}")

    with open(csv_path, "r", encoding=enc) as f:
        reader = csv.reader(f)
        for row in reader:
            row = [c.strip() for c in row if c.strip()]
            if len(row) < 2:
                continue
            prereq, target = row[0], row[1]
            # 跳过可能的表头行
            if prereq in ("先修技能", "先修", "prerequisite") or prereq.startswith("#"):
                continue
            skills_set.add(prereq)
            skills_set.add(target)
            edges.append((prereq, target))
    skills = sorted(skills_set)
    return skills, edges


def build_matrix(skills: list[str], edges: list[tuple[str, str]]) -> np.ndarray:
    """构建 N×N 先修矩阵: matrix[先修][后继] = 1"""
    name_to_idx = {name: i for i, name in enumerate(skills)}
    N = len(skills)
    matrix = np.zeros((N, N), dtype=np.float32)
    for prereq, target in edges:
        if prereq in name_to_idx and target in name_to_idx:
            matrix[name_to_idx[prereq], name_to_idx[target]] = 1.0
    return matrix


def print_matrix(matrix: np.ndarray, skills: list[str]):
    """打印矩阵，便于验证"""
    N = len(skills)
    header = f"{'':>8}"
    for n in skills:
        header += f"{n:>8}"
    print(header)
    for i, n in enumerate(skills):
        row = f"{n:>8}"
        for j in range(N):
            row += f"{int(matrix[i,j]):>8}"
        print(row)


def print_template():
    """输出 CSV 模板"""
    print("先修技能,后续技能")
    for prereq, target in DEFAULT_EDGES:
        print(f"{prereq},{target}")


def main():
    csv_path = None
    out_path = "logic_matrix.npy"

    # 解析命令行参数
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--csv" and i + 1 < len(args):
            csv_path = args[i + 1]
            i += 2
        elif args[i] == "-o" and i + 1 < len(args):
            out_path = args[i + 1]
            i += 2
        elif args[i] == "--template":
            print_template()
            return
        else:
            i += 1

    # 加载数据
    if csv_path:
        skills, edges = load_from_csv(csv_path)
        print(f"[CSV导入] {csv_path}: {len(skills)} 个技能, {len(edges)} 条边")
    else:
        skills, edges = DEFAULT_SKILLS, DEFAULT_EDGES
        print(f"[默认示例] {len(skills)} 个技能, {len(edges)} 条边")
        print("  提示: 使用 --csv 参数从文件导入自定义数据")
        print("  提示: 使用 --template 导出 CSV 模板")

    # 构建矩阵
    matrix = build_matrix(skills, edges)
    np.save(out_path, matrix)

    print(f"\n已生成: {out_path}  ({len(skills)} 技能, {int(matrix.sum())} 条先修边)")
    print(f"\n先修矩阵 (行=先修, 列=后继):")
    print_matrix(matrix, skills)
    print(f"\n技能索引:")
    for i, name in enumerate(skills):
        prereqs = [skills[p] for p in range(len(skills)) if matrix[p, i] > 0]
        deps = [skills[d] for d in range(len(skills)) if matrix[i, d] > 0]
        print(f"  [{i}] {name}")
        if prereqs:
            print(f"      先修: {', '.join(prereqs)}")
        if deps:
            print(f"      后继: {', '.join(deps)}")


if __name__ == "__main__":
    main()
