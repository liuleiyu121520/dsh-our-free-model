S12-B 等宽/表格数字留痕台账（BA-4 落点 #5；grep 口径：tabular-nums / mono-font / Consolas）

## tabular-nums（保留=数据表格/统计数值对齐；其余场景已在 S12-B 移除）
  connection.css:56:  font-variant-numeric: tabular-nums;
  connection.css:316:  font-variant-numeric: tabular-nums;
  app.css:125:.count-badge { margin-left: auto; font-size: 11px; padding: 0 6px; background: #d9f2e5; border-radius: 4px; font-variant-numeric: tabular-nums; }
  app.css:164:.dashboard-metric strong { display: block; font-size: 29px; font-weight: 600; font-variant-numeric: tabular-nums; margin: 12px 0 2px; line-height: 1.3; letter-spacing: -0.01em; }
  app.css:176:.dashboard-chart-column { z-index: 1; flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; font-variant-numeric: tabular-nums; }
  app.css:217:.channel-summary-strip strong { color: var(--ink); font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; }
  app.css:512:  .dashboard-metric strong { font-size: 25px; font-variant-numeric: tabular-nums; }
  app.css:566:/* S12-B：统计数字/页头/徽标回归正文字体，仅保留 tabular-nums 对齐（kbd 仍等宽） */
  app.css:571:  font-variant-numeric: tabular-nums;
  app.css:575:  font-variant-numeric: tabular-nums;
  app.css:582:  font-variant-numeric: tabular-nums;
  app.css:803:[data-theme="dark"] .dashboard-chart-column > span { font-variant-numeric: tabular-nums; font-size: 11px; }
  app.css:846:[data-theme="dark"] .ov-failure-row { border-left: 2px solid var(--cp-red); font-variant-numeric: tabular-nums; }
  app.css:1920::root:not([data-theme="dark"]) .usage-total { font-variant-numeric: tabular-nums; }
  app.css:2753:.dashboard-chart-column > span { letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }
  app.css:2805:.connect-steps b { flex: 0 0 auto; margin-right: 0; font-variant-numeric: tabular-nums; }
  app.css:2830:.runtime-check strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
  app.css:3007:.ui-badge { padding: 3px 8px; line-height: 1.35; font-variant-numeric: tabular-nums; }
  app.css:3877:  font-variant-numeric: tabular-nums !important;
  app.css:4461:.dsh-import-chip strong { font-variant-numeric: tabular-nums; color: var(--green); }
  app.css:4484:.requests-time, .requests-tokens { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
  app.css:4503:.model-list-toolbar > span[role="status"] { font-variant-numeric: tabular-nums; font-size: 12px; }
  calendar.css:10:.calendar-month-label { min-width: 108px; text-align: center; font-size: 14px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
  calendar.css:30:.calendar-cell-day { font-size: 13px; font-weight: 550; color: var(--ink); font-variant-numeric: tabular-nums; line-height: 1.2; }
  calendar.css:31:.calendar-cell-tokens { font-size: 15px; font-weight: 600; color: var(--green-ink); font-variant-numeric: tabular-nums; line-height: 1.2; }
  calendar.css:59:.calendar-drawer-head h2 { font-size: 15px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
  calendar.css:66:.calendar-model-nums { display: flex; align-items: baseline; gap: 8px; flex-shrink: 0; font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
  calendar.css:68:.calendar-sum-row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; padding: 9px 10px; border-radius: var(--radius-control); background: var(--accent-soft); border: 1px solid var(--accent-line); font-size: 12px; color: var(--ink); font-variant-numeric: tabular-nums; }
  calendar.css:76:.calendar-claim-amount { font-size: 11.5px; color: var(--success-ink); font-variant-numeric: tabular-nums; }
  calendar.css:77:.calendar-claim-time { font-size: 11px; color: var(--ink-quiet); font-variant-numeric: tabular-nums; }
  channels.css:200:  font-variant-numeric: tabular-nums !important;
  channels.css:398:  /* S12-B：渠道统计数字回归正文字体，tabular-nums 保留（数据对齐） */
  channels.css:399:  font-variant-numeric: tabular-nums;
  channels.css:484:  font-variant-numeric: tabular-nums;
  channels.css:520:  font-variant-numeric: tabular-nums;
  smart.css:12:.smart-hit-chip { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--accent-line); border-radius: 999px; background: var(--accent-soft); font-size: 12.5px; color: var(--ink); font-variant-numeric: tabular-nums; }
  smart.css:51:.smart-accounts { font-size: 11.5px; padding: 3px 8px; border-radius: 999px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  smart.css:67:.smart-pool-order { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 6px; background: var(--accent-soft); color: var(--green-ink); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  smart.css:94:.smart-status-accounts { font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  settings.css:31:.settings-number input { width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; transition: border-color 150ms var(--ease-out-expo), box-shadow 150ms var(--ease-out-expo); }
  settings.css:61:.settings-number .settings-hint { display: block; font-size: 11px; color: var(--muted); margin-top: 6px; font-variant-numeric: tabular-nums; }
  settings.css:139:.ch-metric-value { font-size: 19px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; line-height: 1.25; }
  settings.css:148:.channel-filters button span { padding: 1px 6px; background: rgba(72, 58, 42, 0.08); border-radius: 8px; font-variant-numeric: tabular-nums; font-weight: 550; color: var(--ink-soft); }
  settings.css:151:/* 供应商卡片：logo 质感 / 计数 tabular-nums / 悬停按钮显现 */
  settings.css:155:.provider-counts strong { font-variant-numeric: tabular-nums; font-weight: 600; }
  settings.css:207:.ofm_root .ofm_num, .ofm_root .ofm_kpivalue, .ofm_root .ofm_credittotal { font-variant-numeric: tabular-nums; }
  settings.css:766:  font-variant-numeric: tabular-nums;

## mono 字体保留清单（代码/命令/标识符/键盘键场景，BA-4 允许）
  calendar.css:65:.calendar-model-id { flex: 1; min-width: 0; font-family: var(--mono-font, monospace); font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  connection.css:55:  font-family: var(--mono-font, monospace);
  connection.css:193:  font-family: var(--mono-font, monospace);
  connection.css:234:  font-family: var(--mono-font, Consolas, monospace);
  connection.css:315:  font-family: var(--mono-font, monospace);
  connection.css:611:  font-family: var(--mono-font, monospace);
  connection.css:623:  font-family: "JetBrains Mono", "Cascadia Code", "Fira Code", "SF Mono", Consolas, monospace !important;
  connection.css:718:  font-family: var(--mono-font, monospace);
  connection.css:817:  font-family: var(--mono-font, monospace);
  connection.css:919:.cx-auto-alias code { font-family: var(--mono-font, monospace); font-size: 12px; padding: 1px 6px; border-radius: 6px; background: var(--accent-soft); color: var(--green-ink); border: 1px solid var(--accent-line); }
  app.css:104:code, pre { font-family: Consolas, "SFMono-Regular", monospace; }
  app.css:332:.copy-field input { flex: 1; font-family: Consolas, monospace; }
  app.css:372:  font-family: var(--mono-font);
  app.css:435:  font-family: var(--mono-font);
  app.css:473:.login-help textarea { display: block; width: 100%; font-family: Consolas, monospace; font-size: 11px; margin: 8px 0; resize: vertical; }
  app.css:574:  font-family: Consolas, "Cascadia Mono", "SF Mono", "JetBrains Mono", monospace;
  app.css:819:  font-family: Consolas, monospace;
  app.css:821:[data-theme="dark"] .quick-endpoint code { color: #6EE7B7; font-family: Consolas, monospace; }
  app.css:1629:  font-family: Consolas, "SFMono-Regular", monospace; font-size: 11px; line-height: 1.5;
  app.css:2281:  --mono-font: ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "SFMono-Regular", "DejaVu Sans Mono", monospace;
  app.css:2676:code, pre, kbd { font-family: var(--mono-font); }
  app.css:2915:code, pre, kbd { font-family: var(--mono-font); }
  smart.css:48:.smart-candidate-id { font-family: var(--mono-font, monospace); font-size: 12.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  smart.css:70:.smart-pool-id { flex: 1; min-width: 0; font-family: var(--mono-font, monospace); font-size: 12.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  smart.css:89:.smart-status-id { flex: 1; min-width: 0; font-family: var(--mono-font, monospace); font-size: 12.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  settings.css:99:.cx-field input { flex: 1; min-width: 0; border: 0; background: transparent; padding: 9px 0; font-family: Consolas, "SFMono-Regular", monospace; font-size: 12.5px; box-shadow: none !important; }
  settings.css:114:  font-family: Consolas, "SFMono-Regular", monospace; font-size: 12px; line-height: 1.75;
  settings.css:206:.ofm_root .ofm_mono, .ofm_root .ofm_id { font-family: Consolas, "SFMono-Regular", monospace; }
  settings.css:765:  font-family: Consolas, "SFMono-Regular", monospace;

## S12-B 已转换（mono→正文，tabular-nums 视场景保留）
  - app.css 卡片页头 h2/h3/p、card-foot、eyebrow、h1、空态文本、图表轴标签：
      mono 已移除（V5 夜层改写）；轴标签/KPI 统计保留 tabular-nums
  - app.css 徽章 ui-badge / count-badge / topbar-divider / console-breadcrumb：
      mono 已移除；数值徽章保留 tabular-nums
  - app.css connect-steps span / copy-feedback / ov-failure-row：mono 已移除
  - channels.css .ofm_num（渠道卡统计数字）：mono→正文字体，tabular-nums 保留
  - app.css quick-endpoint / copy-field / login-command / cx-code / kbd / ofm_id /
    calendar-model-id / cx-picker-id（端点/密钥/命令/代码/键/模型 id）：保留 mono
