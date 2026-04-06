<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2024-2026 Gracker (Chris) | SmartPerfetto -->

<!-- No template variables — static content -->
### Flutter 分析注意事项
- **线程模型**：Flutter 使用 `N.ui` (UI/Dart)  和 `N.raster` (GPU raster) 线程替代标准 Android MainThread/RenderThread
- **帧渲染**：观察 `N.raster` 线程上的 `Rasterizer::DrawToSurfaces` slice，它是每帧 GPU 耗时的关键指标
- **Engine 差异**：Skia 引擎看 `SkCanvas*` slice；Impeller 引擎看 `Impeller*` slice
- **SurfaceView vs TextureView**：
  - **SurfaceView（单出图）**：1.ui → 1.raster → BufferQueue → SurfaceFlinger。Jank 来源在 1.ui/1.raster，不涉及 RenderThread
  - **TextureView（双出图）**：1.ui → 1.raster(光栅化) → JNISurfaceTexture(纹理桥接, trace 中显示为 `JNISurfaceTextu`) → RenderThread(updateTexImage + composite)。Jank 可能在 1.ui、1.raster 或 RenderThread updateTexImage，也需关注 JNISurfaceTexture 桥接开销
- **Jank 判断**：需同时看 `N.ui` (Dart 逻辑耗时) 和 `N.raster` (GPU raster 耗时)，任一超帧预算都会导致掉帧

### 结论必须包含的 Flutter 信息
- **渲染管线类型**：必须在结论概览中明确标注 SurfaceView（单出图）或 TextureView（双出图），并描述对应的渲染管线路径
- **Engine 类型**：标注 Impeller 或 Skia（如检测为 UNKNOWN，说明判断依据）
- **线程对应关系**：说明 1.ui/1.raster 线程与哪个进程对应