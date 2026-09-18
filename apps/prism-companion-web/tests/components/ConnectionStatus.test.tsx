import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionStatus } from "../../src/components/ConnectionStatus";
import { expectNoA11yViolations } from "../a11y/axeHelper";
import type { ConnectionStatus as Status } from "../../src/hooks/useRealtimeEvents";

describe("ConnectionStatus", () => {
  it.each<Status>(["connecting", "open", "closed"])(
    "announces %s status via role=status text (not color alone) and passes axe",
    async (status) => {
      const { container, getByRole } = render(<ConnectionStatus status={status} />);
      expect(getByRole("status")).toHaveTextContent(/./);
      await expectNoA11yViolations(container);
    },
  );
});
