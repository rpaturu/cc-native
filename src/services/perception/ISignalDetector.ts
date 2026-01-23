/**
 * ISignalDetector - Abstract interface for signal detection logic
 * 
 * Detectors are pure functions over EvidenceSnapshots.
 * They analyze evidence and emit signals deterministically.
 */

import { Signal, SignalType } from '../../types/SignalTypes';
import { EvidenceSnapshotRef } from '../../types/SignalTypes';
import { AccountState } from '../../types/LifecycleTypes';

/**
 * Signal Detector Interface
 */
export interface ISignalDetector {
  /**
   * Get detector version
   */
  getDetectorVersion(): string;

  /**
   * Get supported signal types
   */
  getSupportedSignals(): SignalType[];

  /**
   * Detect signals from evidence snapshot
   * 
   * Pure function over EvidenceSnapshotRef.
   * Returns signals deterministically based on evidence.
   * 
   * @param snapshotRef - Immutable evidence snapshot reference
   * @param priorState - Optional AccountState for context-aware detection
   * @returns Array of detected signals (may be empty)
   */
  detect(
    snapshotRef: EvidenceSnapshotRef,
    priorState?: AccountState
  ): Promise<Signal[]>;
}
