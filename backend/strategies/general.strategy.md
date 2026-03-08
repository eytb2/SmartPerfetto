---
scene: general
priority: 99
effort: high
keywords: []
---

#### 通用分析

当前查询未匹配到特定场景策略。请使用 `list_skills` 查找适合的分析技能，或使用 `execute_sql` 做自定义查询。
常见场景概要：
- **滑动/卡顿**: scrolling_analysis → jank_frame_detail (逐帧深钻)
- **启动**: startup_analysis → startup_detail
- **ANR**: anr_analysis → anr_detail
- **点击/触摸**: click_response_analysis → click_response_detail (逐事件深钻)
- **概览/场景还原**: scene_reconstruction → 按场景路由到对应 Skill
- **CPU/内存/GPU**: cpu_analysis, memory_analysis, gpu_analysis
