# 发布记录（o-free-model@1.3.1）

- 时间：2026-11-21T14:26:29.023Z
- 版本：1.3.1
- git HEAD：b31f1ff96b023fc72149f5b8f3e3ea738dd5c724
- tgz：dist/o-free-model-1.3.1.tgz
- tgz sha256：9cf31bc6ab7e351c4fd7c4efd4a25fee68e1f80f5bb0adcc8249fbaa1cab1ed9
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.3.1）
- npm view o-free-model@1.3.1（version/dist-tags）：
  ```
  {
    "version": "1.3.1",
    "dist-tags": {
      "latest": "1.3.1"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
