import type { Bot } from "@linux-agent/shared";
import type { ReactNode } from "react";

const A_COUNT = 45;
const pad = (n: number): string => String(n).padStart(2, "0");
/** 1..45 are the "a" pictures and 46..122 the "b" ones, matching the files in public/avatars. */
export const avatarSrc = (n: number): string => (n <= A_COUNT ? `/avatars/a${pad(n)}.webp` : `/avatars/b${pad(n - A_COUNT)}.webp`);

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
