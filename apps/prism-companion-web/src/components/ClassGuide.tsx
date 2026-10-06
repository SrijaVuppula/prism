// What each Signal Class means for delivery -- the same channel rules the
// backend's orchestration applies (agentOrchestration.ts), stated plainly.

const CLASS_GUIDE = [
  { key: "urgent", icon: "■", name: "Urgent", channels: "Card, vibration and push" },
  { key: "notable", icon: "▲", name: "Notable", channels: "Card and vibration" },
  { key: "routine", icon: "●", name: "Routine", channels: "Card only" },
];

export function ClassGuide() {
  return (
    <ul className="class-guide">
      {CLASS_GUIDE.map((entry) => (
        <li key={entry.key} className={`class-guide__item class-guide__item--${entry.key}`}>
          <span className="class-guide__name">
            <span aria-hidden="true">{entry.icon}</span> {entry.name}
          </span>
          <span className="class-guide__channels">{entry.channels}</span>
        </li>
      ))}
    </ul>
  );
}
