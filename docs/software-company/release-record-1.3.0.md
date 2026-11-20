# 发布记录（o-free-model@1.3.0）

- 时间：2026-11-20T08:48:21.655Z
- 版本：1.3.0
- git HEAD：8a686b836ee11f2e9d127591c5bdf18b29bd1d1d
- tgz：dist/o-free-model-1.3.0.tgz
- tgz sha256：dea3ee72b26dd545c6dc94c777622a046c5c156a5572557b7d26378a8f870a65
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.3.0）
- npm view o-free-model@1.3.0（version/dist-tags）：
  ```
  {
    "version": "1.3.0",
    "dist-tags": {
      "latest": "1.3.0"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
