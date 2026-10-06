// Labeled event set for the classification/orchestration evaluation harness
// (see runEvaluation.ts). Each entry names a fixture image under
// fixtures/<id>.jpg -- see fixtures/README.md.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { EventCategory } from "prism-alert-engine";

export interface LabeledEvent {
  id: string;
  expectedCategory: EventCategory;
  notes: string;
  snapshotUrl: string;
}

const FIXTURES_DIR = join(__dirname, "fixtures");

function fixture(id: string, expectedCategory: EventCategory, notes: string): LabeledEvent {
  return {
    id,
    expectedCategory,
    notes,
    snapshotUrl: pathToFileURL(join(FIXTURES_DIR, `${id}.jpg`)).href,
  };
}

export const LABELED_EVENTS: LabeledEvent[] = [
  // -- person --------------------------------------------------------------
  fixture("person-front-door-daylight", "person", "Baseline: one person standing at the door in good daylight."),
  fixture("person-delivery-holding-box", "person", "Edge case: a person carrying a box -- should read as person, not package, since no package has been set down."),
  fixture("person-night-lowlight", "person", "Person at night under porch light, low overall illumination."),
  fixture("person-group-of-two", "person", "Two people in frame together."),
  fixture("person-partial-frame", "person", "Person cropped at the frame edge, only partially visible."),
  fixture("person-far-from-camera", "person", "Person small in frame, far from the camera (e.g. at the curb)."),
  fixture("person-heavy-rain", "person", "Person at the door during heavy rain, water on the lens."),
  fixture("person-with-dog", "person", "Edge case: a person walking a dog -- primary subject is the person, dog is incidental."),
  fixture("person-face-obscured", "person", "Person with face obscured (mask, hood, or looking away)."),
  fixture("person-walking-away", "person", "Person mid-stride, back turned to the camera, walking away."),

  // -- package ---------------------------------------------------------------
  fixture("package-doorstep-daylight", "package", "Baseline: a single package on the doorstep in daylight."),
  fixture("package-doorstep-night-flash", "package", "Package on the doorstep at night, lit by the camera's IR/flash."),
  fixture("package-small-envelope", "package", "A small envelope or padded mailer rather than a box."),
  fixture("package-partial-frame", "package", "Package only partially in frame, cut off at the edge."),
  fixture("package-multiple-stacked", "package", "Several packages stacked together."),
  fixture("package-behind-planter", "package", "Package partially occluded by a planter or other object in the foreground."),
  fixture("package-unusual-shape", "package", "A package that isn't a standard box (tube, bag, flower delivery)."),
  fixture("package-long-shadow", "package", "Package with a long, distracting shadow across most of the frame."),

  // -- vehicle -----------------------------------------------------------
  fixture("vehicle-car-parked-driveway", "vehicle", "Baseline: a car parked in the driveway, stationary."),
  fixture("vehicle-car-passing-motion-blur", "vehicle", "A car passing on the street, motion-blurred."),
  fixture("vehicle-delivery-truck", "vehicle", "A delivery truck (e.g. UPS/FedEx) in the driveway or street."),
  fixture("vehicle-motorcycle", "vehicle", "A motorcycle parked or passing."),
  fixture("vehicle-bicycle", "vehicle", "Edge case: a bicycle -- treated as a vehicle rather than unclassifiable."),
  fixture("vehicle-night-headlights", "vehicle", "Car at night with headlight glare washing out part of the frame."),
  fixture("vehicle-partial-frame", "vehicle", "Vehicle only partially in frame."),
  fixture("vehicle-two-in-frame", "vehicle", "Two vehicles visible at once."),

  // -- animal ------------------------------------------------------------
  fixture("animal-dog-walking-by", "animal", "Baseline: a dog (without an owner in frame) walking through the yard."),
  fixture("animal-cat-on-porch", "animal", "A cat sitting on the porch."),
  fixture("animal-squirrel-close", "animal", "A squirrel close to the camera."),
  fixture("animal-bird-at-feeder", "animal", "A bird at a feeder or on the railing."),
  fixture("animal-raccoon-night", "animal", "A raccoon at night, IR-lit."),
  fixture("animal-dog-with-owner-background", "animal", "Edge case: a dog investigating close to the camera with its owner only partially visible in the background -- primary subject is the dog."),
  fixture("animal-deer-in-yard", "animal", "A deer in the yard, mid-distance."),
  fixture("animal-motion-blur-night", "animal", "An animal moving quickly at night, motion-blurred and hard to make out."),
];
