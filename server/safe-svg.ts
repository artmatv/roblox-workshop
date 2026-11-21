export function assertSafeSvg(value: string) {
  if (
    !/^<svg\b/.test(value.trim()) ||
    /<\s*(?:script|foreignObject|iframe|object|embed|image|style)\b|<!DOCTYPE|<!ENTITY|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(
      value,
    )
  )
    throw new Error(
      "SVG пакета должен содержать только автономную векторную иллюстрацию",
    );
}
