export const VERIFICATION_LABELS = Object.freeze({
  unverified: "尚待驗證",
  single_source: "單一來源報導",
  multi_source: "多來源交叉確認",
  primary_source_confirmed: "第一手來源確認",
  official_confirmed: "官方來源確認",
  disputed: "來源有爭議",
  corrected: "已更正",
  retracted: "已撤回"
});

export function verificationLabel(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return VERIFICATION_LABELS[key] || "驗證狀態未知";
}
