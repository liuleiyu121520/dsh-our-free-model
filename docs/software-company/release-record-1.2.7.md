# 发布记录（our-free-model-standalone@1.2.7）

- 时间：2026-11-20T05:17:55.054Z
- 版本：1.2.7
- git HEAD：d05fa92935af04d651d7657a337838f26a7cce27
- tgz：dist/our-free-model-standalone-1.2.7.tgz
- tgz sha256：7bce1ff9fe4ea3cb1999aaaa052243d1770d46fbe93be2569d7674148598d45b
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=1.2.7）
- npm view our-free-model-standalone@1.2.7（version/dist-tags）：
  ```
  {
    "version": "1.2.7",
    "dist-tags": {
      "latest": "1.2.7"
    }
  }
  ```
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
