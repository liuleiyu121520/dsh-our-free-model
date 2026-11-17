# S11 发布记录（our-free-model-standalone@1.1.0）

- 时间：2026-11-16T23:41:24.582Z
- 版本：1.1.0
- git HEAD：ff17b26d82c32e498d5e1807984be0dd9d56d65e
- tgz：dist/our-free-model-standalone-1.1.0.tgz
- tgz sha256：a321a3c64ade3ddff5824cc6c3bf426c647e7e3ff12ee9faa454b35870bad16f
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.1.0）
- npm view our-free-model-standalone@1.1.0（version/dist-tags）：
  ```
  {
    "version": "1.1.0",
    "dist-tags": {
      "latest": "1.1.0"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
