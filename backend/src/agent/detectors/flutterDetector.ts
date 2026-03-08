/**
 * Flutter Architecture Detector
 *
 * 检测 Flutter 应用的渲染架构，识别 Skia/Impeller 引擎和版本特征
 */

import { BaseDetector } from './baseDetector';
import {
  DetectorContext,
  DetectorResult,
  DetectionEvidence,
  FlutterEngine,
} from './types';

export class FlutterDetector extends BaseDetector {
  readonly name = 'FlutterDetector';
  readonly targetType = 'FLUTTER' as const;

  async detect(context: DetectorContext): Promise<DetectorResult> {
    const evidence: DetectionEvidence[] = [];
    let flutterEngine: FlutterEngine = 'UNKNOWN';
    let versionHint: string | undefined;
    let newThreadModel = false;

    // 1. 检测 Flutter UI 线程 (1.ui 或 io.flutter.ui)
    const uiThread = await this.hasThread(context, '%.ui');
    if (uiThread.exists) {
      // 检查是否是 Flutter 的 UI 线程 (通常是 "1.ui")
      const flutterUiMatch = uiThread.matches.find(
        (t) => /^\d+\.ui$/.test(t) || t.includes('flutter')
      );
      if (flutterUiMatch) {
        evidence.push(
          this.createEvidence(
            'thread',
            flutterUiMatch,
            0.3,
            'Flutter UI thread detected'
          )
        );
      }
    }

    // 2. 检测 Flutter Raster 线程 (1.raster)
    const rasterThread = await this.hasThread(context, '%.raster');
    if (rasterThread.exists) {
      const flutterRasterMatch = rasterThread.matches.find((t) =>
        /^\d+\.raster$/.test(t)
      );
      if (flutterRasterMatch) {
        evidence.push(
          this.createEvidence(
            'thread',
            flutterRasterMatch,
            0.3,
            'Flutter Raster thread detected'
          )
        );
      }
    }

    // 3. 检测 Flutter IO 线程 (1.io)
    const ioThread = await this.hasThread(context, '%.io');
    if (ioThread.exists) {
      const flutterIoMatch = ioThread.matches.find((t) => /^\d+\.io$/.test(t));
      if (flutterIoMatch) {
        evidence.push(
          this.createEvidence(
            'thread',
            flutterIoMatch,
            0.1,
            'Flutter IO thread detected'
          )
        );
      }
    }

    // 4. 检测 Flutter 相关 Slice
    const flutterSlice = await this.hasSlice(context, 'flutter::%');
    if (flutterSlice.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `flutter::* (${flutterSlice.count} occurrences)`,
          0.2,
          'Flutter framework slices detected'
        )
      );
    }

    // 5. 检测 Impeller 渲染引擎
    const impellerSlice = await this.hasSlice(context, '%impeller%');
    if (impellerSlice.exists) {
      flutterEngine = 'IMPELLER';
      evidence.push(
        this.createEvidence(
          'slice',
          `Impeller (${impellerSlice.count} occurrences)`,
          0.15,
          'Impeller rendering engine detected'
        )
      );
      // Impeller 默认从 Flutter 3.16 开始在 Android 上启用 (January 2024)
      versionHint = '>=3.16';
    }

    // 6. 检测 Skia 渲染引擎 (如果没有 Impeller)
    if (flutterEngine !== 'IMPELLER') {
      const skiaSlice = await this.hasSlice(context, '%Sk%Gpu%');
      if (skiaSlice.exists) {
        flutterEngine = 'SKIA';
        evidence.push(
          this.createEvidence(
            'slice',
            `Skia GPU (${skiaSlice.count} occurrences)`,
            0.1,
            'Skia rendering engine detected'
          )
        );
        versionHint = '<3.16 or Skia fallback';
      }
    }

    // 7. 检测 EntityPass (Impeller 特有)
    const entityPass = await this.hasSlice(context, '%EntityPass%');
    if (entityPass.exists) {
      if (flutterEngine !== 'IMPELLER') {
        flutterEngine = 'IMPELLER';
      }
      evidence.push(
        this.createEvidence(
          'slice',
          'EntityPass',
          0.1,
          'Impeller EntityPass detected'
        )
      );
    }

    // 8. 检测 Flutter 进程
    const flutterProcess = await this.hasProcess(context, '%flutter%');
    if (flutterProcess.exists) {
      evidence.push(
        this.createEvidence(
          'process',
          flutterProcess.matches[0],
          0.1,
          'Flutter process detected'
        )
      );
    }

    // 9. 检测新线程模型 (3.29+): Dart 代码在主线程执行
    // 如果没有独立的 UI 线程但有 Flutter slice，可能是新模型
    if (evidence.length > 0 && !uiThread.exists) {
      const flutterMainSlice = await this.hasSlice(
        context,
        'Framework::BeginFrame'
      );
      if (flutterMainSlice.exists) {
        newThreadModel = true;
        versionHint = '>=3.29 (new thread model)';
        evidence.push(
          this.createEvidence(
            'slice',
            'Framework::BeginFrame on main thread',
            0.05,
            'New thread model (3.29+) detected'
          )
        );
      }
    }

    // 计算置信度
    const confidence = this.calculateConfidence(evidence);

    // 如果没有足够的证据，返回未知
    if (confidence < 0.3) {
      return this.createEmptyResult();
    }

    return {
      type: 'FLUTTER',
      confidence,
      evidence,
      metadata: {
        flutter: {
          engine: flutterEngine,
          versionHint,
          newThreadModel,
        },
      },
    };
  }
}
