# 发布记录（our-free-model-standalone@1.2.2）

- 时间：2026-11-17T08:00:08.912Z
- 版本：1.2.2
- git HEAD：26d7a394ef94e9b1ebf7809c6f7cce9596038173
- tgz：dist/our-free-model-standalone-1.2.2.tgz
- tgz sha256：812a9361b28e5aceeb0ceea424037dfd89a752d0ed7f12c6c16e98a126b778c1
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.2.2）
- npm view our-free-model-standalone@1.2.2（version/dist-tags）：
  ```
  {
    "version": "1.2.2",
    "dist-tags": {
      "latest": "1.2.2"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
