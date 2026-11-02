import type { Bot } from "@linux-agent/shared";
import type { ReactNode } from "react";

export const avatarSrc = (n: number): string => `/avatars/${String(n).padStart(2, "0")}.png`;

/** A bot's picture inside a soft ring. `badge` sits on the start-top corner (pending approvals). */
export function BotAvatar({ bot, size = "md", busy = false, badge }: { bot: Pick<Bot, "avatar" | "name">; size?: "sm" | "md" | "lg"; busy?: boolean; badge?: ReactNode }) {
  return (
    <span className={`av ${size}${busy ? " busy" : ""}`}>
      <span className="av-ring">
        <span className="av-face">
          <img src={avatarSrc(bot.avatar)} alt="" loading="lazy" draggable={false} />
        </span>
      </span>
      {badge}
    </span>
  );
}
