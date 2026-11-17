# 发布记录（our-free-model-standalone@1.2.0）

- 时间：2026-11-17T03:01:18.683Z
- 版本：1.2.0
- git HEAD：14280e4075e109f190243481c645061345dbb75b
- tgz：dist/our-free-model-standalone-1.2.0.tgz
- tgz sha256：bea6fbdc1e207d3bbf9d531181eec30d95fd295eeff46fd08df4160807a3c3b3
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.2.0）
- npm view our-free-model-standalone@1.2.0（version/dist-tags）：
  ```
  {
    "version": "1.2.0",
    "dist-tags": {
      "latest": "1.2.0"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
