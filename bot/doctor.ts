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
import { generatorsChannel, mintsChannel } from "./announce";

dotenv.config();

const API = "https://discord.com/api/v10";

/** The bits this bot needs, by the names Discord's settings screens use. */
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const MANAGE_CHANNELS = 1n << 4n;
const ADMINISTRATOR = 1n << 3n;

interface Overwrite {
    id: string;
    /** 0 is a role, 1 is a member. */
    type: number;
    allow: string;
    deny: string;
}

/**
 * What the bot may actually do in one channel.
 *
 * Discord's own algorithm, because there is no endpoint that answers it. A
 * server-wide permission is overridden by a channel that denies it, so asking
 * the guild alone reports a bot as able to post in a channel it cannot post
 * in, which is the exact confusion this file exists to end.
 */
function effective(
    everyoneRole: bigint,
    myRoles: { id: string; permissions: bigint }[],
    guildId: string,
    botId: string,
    overwrites: Overwrite[],
): bigint {
    let base = everyoneRole;
    for (const r of myRoles) base |= r.permissions;
    if (base & ADMINISTRATOR) return ~0n;

    const at = (id: string) => overwrites.find((o) => o.id === id);

    // @everyone's overwrite first, then every role the bot holds, then one
    // aimed at the bot itself. Later ones win, which is Discord's order.
    const everyone = at(guildId);
    if (everyone) base = (base & ~BigInt(everyone.deny)) | BigInt(everyone.allow);

    let deny = 0n;
    let allow = 0n;
    for (const r of myRoles) {
        const o = at(r.id);
        if (!o) continue;
        deny |= BigInt(o.deny);
        allow |= BigInt(o.allow);
    }
    base = (base & ~deny) | allow;

    const mine = at(botId);
    if (mine) base = (base & ~BigInt(mine.deny)) | BigInt(mine.allow);

    return base;
}

const missingFrom = (perms: bigint, needed: [bigint, string][]) =>
    needed.filter(([bit]) => !(perms & bit)).map(([, name]) => name);

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
    const inGuilds = Array.isArray(guilds.body)
        ? (guilds.body as { id: string; name: string }[])
        : [];
    if (inGuilds.length === 0) {
        console.log("  servers    none");
        console.log("\n  The bot has not been added to any server. Open the invite URL.\n");
        process.exit(1);
    }
    for (const g of inGuilds) console.log(`  server     ${g.name} (${g.id})`);

    // 3. Each channel, and what the bot may actually do in it.
    //
    // Reading a channel proves View Channel and nothing else. A bot that can
    // read a channel it cannot post in looked healthy here until now, which is
    // the failure this whole file is supposed to catch.
    const RENAME: [bigint, string][] = [
        [VIEW_CHANNEL, "View Channel"],
        [MANAGE_CHANNELS, "Manage Channels"],
    ];
    const ANNOUNCE: [bigint, string][] = [
        [VIEW_CHANNEL, "View Channel"],
        [SEND_MESSAGES, "Send Messages"],
        [EMBED_LINKS, "Embed Links"],
    ];

    const targets = [
        ...channelsFromEnv().map((c) => ({ id: c.id, need: RENAME, job: "rename" })),
        ...(generatorsChannel()
            ? [{ id: generatorsChannel(), need: ANNOUNCE, job: "generators" }]
            : []),
        ...(mintsChannel() ? [{ id: mintsChannel(), need: ANNOUNCE, job: "mints" }] : []),
    ];

    if (targets.length === 0) {
        console.log("\n  No channels configured. See bot/README.md.\n");
        process.exit(1);
    }

    const botId = me.body.id as string;

    /** The bot's roles in one server, fetched once. */
    const perGuild = new Map<
        string,
        { everyone: bigint; mine: { id: string; permissions: bigint }[] }
    >();

    async function rolesIn(guildId: string) {
        const hit = perGuild.get(guildId);
        if (hit) return hit;
        const [roles, member] = await Promise.all([
            ask(token, `/guilds/${guildId}/roles`),
            ask(token, `/guilds/${guildId}/members/${botId}`),
        ]);
        const all = (Array.isArray(roles.body) ? roles.body : []) as {
            id: string;
            permissions: string;
        }[];
        const held = new Set((member.body.roles as string[] | undefined) ?? []);
        const found = {
            // The @everyone role's id is the guild's own id, always.
            everyone: BigInt(all.find((r) => r.id === guildId)?.permissions ?? "0"),
            mine: all
                .filter((r) => held.has(r.id))
                .map((r) => ({ id: r.id, permissions: BigInt(r.permissions) })),
        };
        perGuild.set(guildId, found);
        return found;
    }

    console.log("");
    let bad = 0;

    for (const target of targets) {
        const got = await ask(token, `/channels/${target.id}`);
        if (!got.ok) {
            bad++;
            const why =
                got.code === 50001
                    ? "Missing Access. The bot cannot see this channel: give its role View Channel here, or it is in a server the bot is not in."
                    : got.code === 10003
                      ? "Unknown Channel. That id does not exist, or belongs to a server the bot is not in."
                      : got.code === 50013
                        ? "Missing Permissions."
                        : `${got.message ?? "refused"} (${got.status})`;
            console.log(`  FAILED     ${target.id}  ${target.job}  ${why}`);
            continue;
        }

        const guildId = got.body.guild_id as string;
        const guild = inGuilds.find((g) => g.id === guildId);
        const where = `"${got.body.name}" in ${guild?.name ?? guildId}`;

        const { everyone, mine } = await rolesIn(guildId);
        const perms = effective(
            everyone,
            mine,
            guildId,
            botId,
            (got.body.permission_overwrites as Overwrite[] | undefined) ?? [],
        );
        const missing = missingFrom(perms, target.need);

        if (missing.length === 0) {
            console.log(`  ok         ${target.id}  ${target.job}  ${where}`);
            continue;
        }
        bad++;
        console.log(
            `  FAILED     ${target.id}  ${target.job}  ${where}\n` +
                `             missing ${missing.join(", ")}. ` +
                `Edit Channel, Permissions, add the bot, allow them there.`,
        );
    }

    console.log(
        bad === 0
            ? "\n  Every channel has what its job needs.\n"
            : `\n  ${bad} channel(s) short.\n`,
    );
    process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
});
