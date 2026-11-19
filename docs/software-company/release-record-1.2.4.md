# 发布记录（our-free-model-standalone@1.2.4）

- 时间：2026-11-17T12:37:35.122Z
- 版本：1.2.4
- git HEAD：5d28293be09b1bb35c9064b636f174436aaa6a6b
- tgz：dist/our-free-model-standalone-1.2.4.tgz
- tgz sha256：0aa5bad539c81b1cd13fece8239a79c7f243ec6d4d5f5bc947e92698879fd4e8
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.2.4）
- npm view our-free-model-standalone@1.2.4（version/dist-tags）：
  ```
  {
    "version": "1.2.4",
    "dist-tags": {
      "latest": "1.2.4"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
