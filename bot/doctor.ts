/**
 * Why Discord is refusing.
 *
 *   npm run bot:doctor
 *
 * Every refusal from the API arrives as a 403 or a 404, and from inside a
 * rename they all look alike: the same line whether the bot is in the wrong
 * server, cannot see the channel, or can see it and cannot change it. Each of
 * those is a different screen in Discord's settings, so guessing sends you to
 * the wrong one.
 *
 * This asks the three questions separately and says which of them failed.
 */
import dotenv from "dotenv";
import { channelsFromEnv } from "./discord";

dotenv.config();

const API = "https://discord.com/api/v10";

interface Said {
    ok: boolean;
    status: number;
    code?: number;
    message?: string;
    body: Record<string, unknown>;
}

async function ask(token: string, path: string): Promise<Said> {
    const res = await fetch(`${API}${path}`, { headers: { authorization: `Bot ${token}` } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
        ok: res.ok,
        status: res.status,
        code: body.code as number | undefined,
        message: body.message as string | undefined,
        body,
    };
}

async function main() {
    const token = process.env.DISCORD_BOT_TOKEN || "";
    if (!token) {
        console.log("\nDISCORD_BOT_TOKEN is not set.\n");
        process.exit(1);
    }

    console.log("");

    // 1. Is the token a bot token at all, and whose?
    const me = await ask(token, "/users/@me");
    if (!me.ok) {
        console.log(`  token      rejected: ${me.message ?? me.status}`);
        console.log("\n  The token is wrong, or was reset in the developer portal.\n");
        process.exit(1);
    }
    console.log(`  token      ${me.body.username}#${me.body.discriminator} (${me.body.id})`);

    // 2. Which servers is it actually in? A bot invited to the wrong one, or
    //    never added at all, refuses every channel with the same 403 as a
    //    permission problem.
    const guilds = await ask(token, "/users/@me/guilds");
    const inGuilds = Array.isArray(guilds.body) ? (guilds.body as { id: string; name: string }[]) : [];
    if (inGuilds.length === 0) {
        console.log("  servers    none");
        console.log("\n  The bot has not been added to any server. Open the invite URL.\n");
        process.exit(1);
    }
    for (const g of inGuilds) console.log(`  server     ${g.name} (${g.id})`);

    // 3. Each channel on its own.
    const channels = channelsFromEnv();
    if (channels.length === 0) {
        console.log("\n  DISCORD_STAT_CHANNELS names no channels.\n");
        process.exit(1);
    }

    console.log("");
    let bad = 0;
    for (const channel of channels) {
        const got = await ask(token, `/channels/${channel.id}`);
        if (got.ok) {
            const guild = inGuilds.find((g) => g.id === got.body.guild_id);
            console.log(
                `  ok         ${channel.id}  "${got.body.name}" in ${guild?.name ?? got.body.guild_id}`,
            );
            continue;
        }
        bad++;
        const why =
            got.code === 50001
                ? "Missing Access. The bot cannot see this channel: give its role View Channel here, or it is in a server the bot is not in."
                : got.code === 10003
                  ? "Unknown Channel. That id does not exist, or belongs to a server the bot is not in."
                  : got.code === 50013
                    ? "Missing Permissions."
                    : `${got.message ?? "refused"} (${got.status})`;
        console.log(`  FAILED     ${channel.id}  ${why}`);
    }

    console.log(
        bad === 0
            ? "\n  Every channel is readable. A rename will work.\n"
            : `\n  ${bad} channel(s) unreachable.\n`,
    );
    process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
});
