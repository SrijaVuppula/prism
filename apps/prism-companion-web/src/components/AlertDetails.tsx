// The "how" behind the latest alert, shown beside its card: the Signal
// Score on its 0-100 scale, the factors that produced it, the vibration
// pattern, and which channels the alert went out on.

import type { PrismEvent } from "prism-alert-engine";
import type { ChannelPayloads } from "../types";
import { DeliveryChannels } from "./DeliveryChannels";
import { HapticPattern } from "./HapticPattern";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { SignalMeter } from "./SignalMeter";

export interface AlertDetailsProps {
  event: PrismEvent;
  channels: ChannelPayloads;
}

export function AlertDetails({ event, channels }: AlertDetailsProps) {
  if (!event.scoring) return null;
  return (
    <section className="alert-details" aria-label="Alert details">
      <SignalMeter score={event.scoring.signalScore} signalClass={event.scoring.signalClass} />
      <div className="alert-details__grid">
        <ScoreBreakdown scoring={event.scoring} classification={event.classification} />
        <div className="alert-details__delivery">
          <HapticPattern pattern={channels.haptic} signalClass={event.scoring.signalClass} />
          <DeliveryChannels channels={channels} />
        </div>
      </div>
    </section>
  );
}
