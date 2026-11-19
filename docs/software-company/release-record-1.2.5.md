# 发布记录（our-free-model-standalone@1.2.5）

- 时间：2026-11-19T16:04:16.173Z
- 版本：1.2.5
- git HEAD：959699f7d7f8a80e073eb02a8a85b6f80d462fcf
- tgz：dist/our-free-model-standalone-1.2.5.tgz
- tgz sha256：72d7689e9de11e0f9a97fbc299ed5dc2ef5d131c691220b6e67432c3919344f9
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.2.5）
- npm view our-free-model-standalone@1.2.5（version/dist-tags）：
  ```
  {
    "version": "1.2.5",
    "dist-tags": {
      "latest": "1.2.5"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
