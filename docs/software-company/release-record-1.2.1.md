# 发布记录（our-free-model-standalone@1.2.1）

- 时间：2026-11-17T07:07:58.933Z
- 版本：1.2.1
- git HEAD：f4e6e438e89765c6675edfb497b19197a150f8c6
- tgz：dist/our-free-model-standalone-1.2.1.tgz
- tgz sha256：b8cd4cb1d0cf174724c27e95cfba0cc9b7ec0cc6dae3bf6b0d84e10eaa357177
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.2.1）
- npm view our-free-model-standalone@1.2.1（version/dist-tags）：
  ```
  {
    "version": "1.2.1",
    "dist-tags": {
      "latest": "1.2.1"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
