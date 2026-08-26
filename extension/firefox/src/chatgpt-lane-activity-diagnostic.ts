// SPDX-License-Identifier: MPL-2.0

import type {
  FirefoxChatGptActivityPanelBindingV1,
  FirefoxChatGptActivityPanelObservationV1,
} from "./chatgpt-lane-activity-panel.js";
import {
  parseFirefoxChatGptActivityWireObservationV1,
  type FirefoxChatGptActivityWireObservationV1,
} from "./chatgpt-lane-activity-route.js";

/**
 * Admit one full Firefox wire observation for diagnostic export only after the
 * popup's correlated sample path accepted the same fixed activity tokens.
 *
 * The returned record is the canonical content-free activity observation. It
 * deliberately contains no tab id or private document projection reference.
 */
export function admitFirefoxChatGptActivityDiagnosticV1(
  binding: FirefoxChatGptActivityPanelBindingV1,
  displayObservation: FirefoxChatGptActivityPanelObservationV1,
  wireObservationInput: unknown,
): FirefoxChatGptActivityWireObservationV1 {
  const wire = parseFirefoxChatGptActivityWireObservationV1(wireObservationInput);
  if (
    wire.laneRef !== binding.laneRef ||
    wire.laneGeneration !== binding.laneGeneration
  ) {
    throw new TypeError("Firefox ChatGPT activity diagnostic target is invalid");
  }
  if (
    wire.confidence !== displayObservation.confidence ||
    wire.generation !== displayObservation.generation ||
    wire.composer !== displayObservation.composer ||
    wire.composition !== displayObservation.composition ||
    wire.modal !== displayObservation.modal ||
    wire.mediaOrDevice !== displayObservation.mediaOrDevice ||
    wire.download !== displayObservation.download ||
    wire.otherTransient !== displayObservation.otherTransient
  ) {
    throw new TypeError("Firefox ChatGPT activity diagnostic observation is invalid");
  }
  return wire;
}
