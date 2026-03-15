# Android Rendering Pipeline

## Mechanism

Each frame flows through a multi-stage pipeline driven by VSync signals:

1. **VSync-app** fires, waking the app process
2. **Choreographer#doFrame** on the main thread: input handling, animation, measure, layout, draw (records display list)
3. **syncFrameState** transfers the display list to RenderThread
4. **RenderThread DrawFrame**: dequeueBuffer from BufferQueue, issues GPU commands (OpenGL/Vulkan), queueBuffer back
5. **SurfaceFlinger** receives the buffer at VSync-sf, composites all visible layers via HWC
6. **HWC** (Hardware Composer) sends the final frame to the display

The frame budget is one VSync period: 16.67ms at 60Hz, 11.11ms at 90Hz, 8.33ms at 120Hz. Any stage exceeding its share pushes the frame past deadline.

## Why Jank Appears 2-3 Frames Late

Android uses triple-buffering. When a frame takes too long to render, its buffer arrives late to SurfaceFlinger. SF has no new buffer to display, so it re-displays the stale buffer, causing visible stutter. Because of pipeline depth, the visual jank appears 2-3 VSync cycles after the actual slow frame. This is called **buffer stuffing** -- the pipeline backs up and the user sees the effect downstream.

## Key Trace Signatures

| Slice / Counter | Where | Indicates |
|----------------|-------|-----------|
| `Choreographer#doFrame` | Main thread | App-side frame work (UI thread portion) |
| `DrawFrame` | RenderThread | GPU command recording + buffer submission |
| `dequeueBuffer` | RenderThread | Waiting for a free buffer from BufferQueue |
| `queueBuffer` | RenderThread | Submitting completed buffer to SurfaceFlinger |
| `onMessageInvalidate` | SurfaceFlinger | SF-side composition trigger |
| `HW_VSYNC` counter | Display | Hardware VSync pulse |

## Diagnosis Approach

- Compare `Choreographer#doFrame` duration to VSync period. If it exceeds budget, the bottleneck is on the main thread (measure/layout/draw).
- If main thread is fast but `DrawFrame` is slow, the bottleneck is GPU-side (complex shaders, overdraw, large textures).
- Long `dequeueBuffer` means all buffers are in use -- the pipeline is backed up, often from a previous slow frame.
- Check `FrameMissed` or `StalledByBackpressure` counters on SurfaceFlinger to confirm dropped frames.

## Typical Solutions

- Reduce view hierarchy depth (fewer measure/layout passes)
- Offload heavy work from main thread (use coroutines, HandlerThread)
- Reduce GPU overdraw (flatten layouts, avoid unnecessary backgrounds)
- Use `RenderThread` hints: avoid `canvas.saveLayer()`, minimize path clipping
- Enable hardware layers for complex, static views
