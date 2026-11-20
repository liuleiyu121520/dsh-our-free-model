# 发布记录（our-free-model-standalone@1.2.6）

- 时间：2026-11-20T04:53:29.279Z
- 版本：1.2.6
- git HEAD：78b927c66bbc24f1729e45ccd08a4578c9727d94
- tgz：dist/our-free-model-standalone-1.2.6.tgz
- tgz sha256：2fc8c0429ac3d1578e44296b7fbdcafb03a326a305830df6b4bc24a9ce7493bb
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.2.6）
- npm view our-free-model-standalone@1.2.6（version/dist-tags）：
  ```
  {
    "version": "1.2.6",
    "dist-tags": {
      "latest": "1.2.6"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
