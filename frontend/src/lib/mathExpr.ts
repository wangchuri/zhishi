/** 安全的函数表达式求值（不含 eval / new Function）。 */

type Tok =
  | { kind: "num"; value: number }
  | { kind: "id"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lp" }
  | { kind: "rp" }
  | { kind: "comma" }

const FN1 = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "sec",
  "csc",
  "cot",
  "sinc",
  "exp",
  "ln",
  "log2",
  "log10",
  "sqrt",
  "cbrt",
  "abs",
  "floor",
  "ceil",
  "round",
  "sign",
  "fact",
])
const FN2 = new Set(["min", "max", "atan2", "hypot", "mod"])
const FN3 = new Set(["if", "clamp"])

const FN_NAMES = [...FN1, ...FN2, ...FN3, "log"].join("|")

const CONSTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
}

function matchBrace(s: string, i: number, open: string, close: string): number {
  if (s[i] !== open) return -1
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth += 1
    else if (s[j] === close) {
      depth -= 1
      if (depth === 0) return j
    }
  }
  return -1
}

function takeGroup(s: string, i: number): { inner: string; end: number } | null {
  while (s[i] === " ") i += 1
  if (s[i] === "{") {
    const end = matchBrace(s, i, "{", "}")
    if (end < 0) return null
    return { inner: s.slice(i + 1, end), end: end + 1 }
  }
  if (s[i] === "(") {
    const end = matchBrace(s, i, "(", ")")
    if (end < 0) return null
    return { inner: s.slice(i + 1, end), end: end + 1 }
  }
  const m = s.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*|^[0-9]+(?:\.[0-9]+)?/)
  if (!m) return null
  return { inner: m[0], end: i + m[0].length }
}

function replaceFrac(src: string): string {
  let s = src
  for (let guard = 0; guard < 32; guard++) {
    const i = s.search(/\\frac/)
    if (i < 0) break
    let p = i + 5
    const a = takeGroup(s, p)
    if (!a) break
    const b = takeGroup(s, a.end)
    if (!b) break
    s = `${s.slice(0, i)}((${a.inner})/(${b.inner}))${s.slice(b.end)}`
  }
  return s
}

function replaceSqrt(src: string): string {
  let s = src
  for (let guard = 0; guard < 32; guard++) {
    const m = /\\sqrt\s*(?:\[([^\]]*)\])?/.exec(s)
    if (!m || m.index == null) break
    const g = takeGroup(s, m.index + m[0].length)
    if (!g) break
    const inner = g.inner
    const repl = m[1] ? `((${inner})^(1/(${m[1]})))` : `sqrt(${inner})`
    s = `${s.slice(0, m.index)}${repl}${s.slice(g.end)}`
  }
  return s
}

function stripLatex(src: string): string {
  let s = src
  s = s.replace(/\$\$?/g, "")
  s = s.replace(/\\left|\\right/g, "")
  s = s.replace(/\\,|\\;|\\quad|\\qquad|~/g, " ")
  s = s.replace(/\\cdot|\\times|\\ast/g, "*")
  s = s.replace(/\\div/g, "/")
  s = s.replace(/\\pi\b/g, "pi")
  s = replaceFrac(s)
  s = replaceSqrt(s)
  s = s.replace(
    /\\(sin|cos|tan|asin|acos|atan|arcsin|arccos|arctan|sinh|cosh|tanh|sec|csc|cot|exp|ln|log|sqrt|abs|min|max)\b/g,
    "$1",
  )
  s = s.replace(/\{([^{}]+)\}/g, "($1)")
  s = s.replace(/\\/g, "")
  return s
}

function rewritePowFn(src: string): string {
  const re = new RegExp(`\\b(${FN_NAMES})\\s*\\^\\s*(\\([^)]+\\)|-?\\d+(?:\\.\\d+)?)\\s*\\(`, "gi")
  let s = src
  for (let guard = 0; guard < 32; guard++) {
    const m = re.exec(s)
    if (!m || m.index == null) break
    const lp = m.index + m[0].length - 1
    const rp = matchBrace(s, lp, "(", ")")
    if (rp < 0) break
    const args = s.slice(lp + 1, rp)
    const repl = `((${m[1]}(${args}))^(${m[2]}))`
    s = `${s.slice(0, m.index)}${repl}${s.slice(rp + 1)}`
    re.lastIndex = 0
  }
  return s
}

function rewriteAbsBars(src: string): string {
  const chars = [...src]
  type Kind = "open" | "close"
  const kinds: Kind[] = []
  let operand = false
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === " ") continue
    if (c === "|") {
      kinds.push(operand ? "close" : "open")
      operand = !operand
      continue
    }
    if ("+-*/^<>=!,".includes(c) || c === "(") operand = false
    else operand = true
  }
  if (!kinds.length || kinds.length % 2) return src
  let k = 0
  let out = ""
  for (const c of chars) {
    if (c === "|") {
      out += kinds[k] === "open" ? "abs(" : ")"
      k += 1
    } else out += c
  }
  return out
}

function normalize(src: string): string {
  let s = src.trim()
  s = s.replace(/[–—]/g, "-")
  s = s.replace(/[×⋅·]/g, "*")
  s = s.replace(/÷/g, "/")
  s = s.replace(/，/g, ",")
  s = s.replace(/²/g, "^2")
  s = s.replace(/³/g, "^3")
  s = s.replace(/√\s*/g, "sqrt")
  s = s.replace(/\*\*/g, "^")
  s = s.replace(/π/g, "pi")
  s = stripLatex(s)
  s = rewritePowFn(s)
  s = rewriteAbsBars(s)
  s = s.replace(/arcsin/g, "asin")
  s = s.replace(/arccos/g, "acos")
  s = s.replace(/arctan/g, "atan")
  return s.trim()
}

function tokenize(src: string): Tok[] {
  const s = normalize(src)
  const out: Tok[] = []
  let i = 0
  const isLetter = (c: string) => /[a-zA-Z_]/.test(c)
  const isDigit = (c: string) => /[0-9]/.test(c)
  while (i < s.length) {
    const c = s[i]
    if (c === " " || c === "\t") {
      i += 1
      continue
    }
    if (c === "(") {
      out.push({ kind: "lp" })
      i += 1
      continue
    }
    if (c === ")") {
      out.push({ kind: "rp" })
      i += 1
      continue
    }
    if (c === ",") {
      out.push({ kind: "comma" })
      i += 1
      continue
    }
    if (s.startsWith("<=", i) || s.startsWith(">=", i) || s.startsWith("==", i) || s.startsWith("!=", i)) {
      out.push({ kind: "op", value: s.slice(i, i + 2) })
      i += 2
      continue
    }
    if ("+-*/^%<>".includes(c)) {
      out.push({ kind: "op", value: c })
      i += 1
      continue
    }
    if (isDigit(c) || (c === "." && isDigit(s[i + 1] || ""))) {
      let j = i
      while (j < s.length && (isDigit(s[j]) || s[j] === ".")) j += 1
      if (s[j] === "e" || s[j] === "E") {
        let k = j + 1
        if (s[k] === "+" || s[k] === "-") k += 1
        while (k < s.length && isDigit(s[k])) k += 1
        j = k
      }
      const n = Number(s.slice(i, j))
      if (!Number.isFinite(n)) throw new Error("数字无效")
      out.push({ kind: "num", value: n })
      i = j
      continue
    }
    if (isLetter(c)) {
      let j = i + 1
      while (j < s.length && /[a-zA-Z_0-9]/.test(s[j])) j += 1
      out.push({ kind: "id", value: s.slice(i, j).toLowerCase() })
      i = j
      continue
    }
    throw new Error(`不支持的字符：${c}`)
  }
  return insertMul(out)
}

function isFnName(name: string): boolean {
  return FN1.has(name) || FN2.has(name) || FN3.has(name) || name === "log"
}

function insertMul(tokens: Tok[]): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < tokens.length; i++) {
    const prev = out[out.length - 1]
    const cur = tokens[i]
    if (prev && cur) {
      const left = prev.kind === "num" || prev.kind === "id" || prev.kind === "rp"
      const right = cur.kind === "num" || cur.kind === "id" || cur.kind === "lp"
      const prevFn = prev.kind === "id" && isFnName(prev.value)
      if (left && right && !(prevFn && cur.kind === "lp")) {
        out.push({ kind: "op", value: "*" })
      }
    }
    out.push(cur)
  }
  return out
}

type Node =
  | { type: "num"; value: number }
  | { type: "var" }
  | { type: "const"; value: number }
  | { type: "unary"; op: "-"; arg: Node }
  | { type: "bin"; op: string; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] }

class Parser {
  tokens: Tok[]
  i = 0
  constructor(tokens: Tok[]) {
    this.tokens = tokens
  }
  peek(): Tok | undefined {
    return this.tokens[this.i]
  }
  eat(): Tok {
    const t = this.tokens[this.i]
    if (!t) throw new Error("表达式不完整")
    this.i += 1
    return t
  }
  parse(): Node {
    const n = this.cmp()
    if (this.peek()) throw new Error("表达式末尾有多余内容")
    return n
  }
  opIs(...ops: string[]): boolean {
    const t = this.peek()
    return Boolean(t && t.kind === "op" && ops.includes(t.value))
  }
  cmp(): Node {
    let n = this.expr()
    if (this.opIs("<", ">", "<=", ">=", "==", "!=")) {
      const op = (this.eat() as { value: string }).value
      n = { type: "bin", op, left: n, right: this.expr() }
    }
    return n
  }
  expr(): Node {
    let n = this.term()
    while (this.opIs("+", "-")) {
      const op = (this.eat() as { value: string }).value
      n = { type: "bin", op, left: n, right: this.term() }
    }
    return n
  }
  term(): Node {
    let n = this.unary()
    while (this.opIs("*", "/", "%")) {
      const op = (this.eat() as { value: string }).value
      n = { type: "bin", op, left: n, right: this.unary() }
    }
    return n
  }
  unary(): Node {
    if (this.opIs("-")) {
      this.eat()
      return { type: "unary", op: "-", arg: this.unary() }
    }
    if (this.opIs("+")) {
      this.eat()
      return this.unary()
    }
    return this.power()
  }
  power(): Node {
    const left = this.primary()
    if (this.opIs("^")) {
      this.eat()
      return { type: "bin", op: "^", left, right: this.unary() }
    }
    return left
  }
  primary(): Node {
    const t = this.peek()
    if (!t) throw new Error("表达式不完整")
    if (t.kind === "num") {
      this.eat()
      return { type: "num", value: t.value }
    }
    if (t.kind === "lp") {
      this.eat()
      const n = this.cmp()
      if (this.peek()?.kind !== "rp") throw new Error("缺少 )")
      this.eat()
      return n
    }
    if (t.kind === "id") {
      this.eat()
      const name = t.value
      if (this.peek()?.kind === "lp") {
        this.eat()
        const args: Node[] = []
        if (this.peek()?.kind !== "rp") {
          args.push(this.cmp())
          while (this.peek()?.kind === "comma") {
            this.eat()
            args.push(this.cmp())
          }
        }
        if (this.peek()?.kind !== "rp") throw new Error("缺少 )")
        this.eat()
        if (name === "log") {
          if (args.length !== 1 && args.length !== 2) throw new Error("log 需要 1 或 2 个参数")
        } else if (FN1.has(name)) {
          if (args.length !== 1) throw new Error(`${name} 需要 1 个参数`)
        } else if (FN2.has(name)) {
          if (args.length !== 2) throw new Error(`${name} 需要 2 个参数`)
        } else if (FN3.has(name)) {
          if (args.length !== 3) throw new Error(`${name} 需要 3 个参数`)
        } else {
          throw new Error(`未知函数：${name}`)
        }
        return { type: "call", name, args }
      }
      if (name === "x") return { type: "var" }
      if (name in CONSTS) return { type: "const", value: CONSTS[name] }
      throw new Error(`未知符号：${name}`)
    }
    throw new Error("表达式语法错误")
  }
}

function truthy(n: number): boolean {
  return Number.isFinite(n) && n !== 0
}

function factorial(n: number): number {
  if (!Number.isFinite(n) || n < 0) return NaN
  if (Math.abs(n - Math.round(n)) > 1e-9) return NaN
  const k = Math.round(n)
  if (k > 170) return Infinity
  let a = 1
  for (let i = 2; i <= k; i++) a *= i
  return a
}

function evalNode(node: Node, x: number): number {
  switch (node.type) {
    case "num":
    case "const":
      return node.value
    case "var":
      return x
    case "unary":
      return -evalNode(node.arg, x)
    case "bin": {
      const a = evalNode(node.left, x)
      const b = evalNode(node.right, x)
      switch (node.op) {
        case "+":
          return a + b
        case "-":
          return a - b
        case "*":
          return a * b
        case "/":
          return a / b
        case "%":
          return a % b
        case "^":
          return a ** b
        case "<":
          return a < b ? 1 : 0
        case ">":
          return a > b ? 1 : 0
        case "<=":
          return a <= b ? 1 : 0
        case ">=":
          return a >= b ? 1 : 0
        case "==":
          return a === b ? 1 : 0
        case "!=":
          return a !== b ? 1 : 0
        default:
          return NaN
      }
    }
    case "call": {
      if (node.name === "if") {
        return truthy(evalNode(node.args[0], x)) ? evalNode(node.args[1], x) : evalNode(node.args[2], x)
      }
      const args = node.args.map((n) => evalNode(n, x))
      const v = args[0]
      switch (node.name) {
        case "sin":
          return Math.sin(v)
        case "cos":
          return Math.cos(v)
        case "tan":
          return Math.tan(v)
        case "asin":
          return Math.asin(v)
        case "acos":
          return Math.acos(v)
        case "atan":
          return Math.atan(v)
        case "sinh":
          return Math.sinh(v)
        case "cosh":
          return Math.cosh(v)
        case "tanh":
          return Math.tanh(v)
        case "sec":
          return 1 / Math.cos(v)
        case "csc":
          return 1 / Math.sin(v)
        case "cot":
          return 1 / Math.tan(v)
        case "sinc":
          return Math.abs(v) < 1e-12 ? 1 : Math.sin(v) / v
        case "exp":
          return Math.exp(v)
        case "ln":
          return Math.log(v)
        case "log2":
          return Math.log2(v)
        case "log10":
          return Math.log10(v)
        case "log":
          return args.length === 2 ? Math.log(v) / Math.log(args[1]) : Math.log(v)
        case "sqrt":
          return Math.sqrt(v)
        case "cbrt":
          return Math.cbrt(v)
        case "abs":
          return Math.abs(v)
        case "floor":
          return Math.floor(v)
        case "ceil":
          return Math.ceil(v)
        case "round":
          return Math.round(v)
        case "sign":
          return Math.sign(v)
        case "fact":
          return factorial(v)
        case "min":
          return Math.min(v, args[1])
        case "max":
          return Math.max(v, args[1])
        case "atan2":
          return Math.atan2(v, args[1])
        case "hypot":
          return Math.hypot(v, args[1])
        case "mod":
          return v % args[1]
        case "clamp":
          return Math.min(args[2], Math.max(args[1], v))
        default:
          return NaN
      }
    }
  }
}

export type CompiledExpr =
  | { ok: true; source: string; eval: (x: number) => number }
  | { ok: false; source: string; error: string }

export function compileMathExpr(source: string): CompiledExpr {
  const src = (source || "").trim()
  if (!src) return { ok: false, source: src, error: "表达式为空" }
  try {
    const ast = new Parser(tokenize(src)).parse()
    return {
      ok: true,
      source: src,
      eval: (x: number) => {
        const y = evalNode(ast, x)
        return Number.isFinite(y) ? y : NaN
      },
    }
  } catch (e) {
    return { ok: false, source: src, error: e instanceof Error ? e.message : "无法解析表达式" }
  }
}

export function splitPlotExpressions(raw: string): string[] {
  return raw
    .split(/[;\n；]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
}
