/**
 * Architecture Detectors Module
 *
 * Exports architecture detection types and the YAML-skill-backed detector.
 * Individual TypeScript detector classes (FlutterDetector, WebViewDetector, etc.)
 * have been removed -- all detection is now handled by the
 * `rendering_pipeline_detection` YAML skill.
 */

// Type exports
export * from './types';

// Main detector (delegates to YAML skill)
export {
  ArchitectureDetector,
  createArchitectureDetector,
  detectArchitectureViaSkill,
} from './architectureDetector';
