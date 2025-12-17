import { webhookCallback } from "grammy";
import { CURRENT_KEY, IS_PRODUCTION } from "./constants.ts";
import { logStart } from "./src/general.ts";
import { bot } from "./src/bot.ts";
import { locales } from "./src/locales.ts";
import dice from "./src/intents/dice.ts";
import redeemCode from "./src/intents/redeemCode.ts";
import horses from "./src/intents/horses.ts";
import { getUserStateSafe } from "./src/helpers.ts";
import { kv } from "./src/kv.ts";
import type { UserState } from "./src/types.ts";
import { GameManager } from "./src/poker/GameManager.ts";
import { validateWebAppData } from "./src/helpers/telegram.ts";

console.log("VERSION 2.0 STARTING...");

// --- Poker Manager ---
const gameManager = new GameManager();

// Casino Lock Middleware
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId && gameManager.isUserPlaying(userId)) {
        // Allow harmless commands
        if (ctx.message?.text?.startsWith('/balance') ||
            ctx.message?.text?.startsWith('/top') ||
            ctx.message?.text?.startsWith('/help') ||
            ctx.message?.text?.startsWith('/start') ||
            ctx.message?.text?.startsWith('/__debug')) {
            return next();
        }

        // Block specific casino intents
        // Check for Dice
        if (ctx.message?.dice) {
             const messages = [
                 "Вы сейчас играете в покер, нельзя крутить слоты!",
                 "Сначала закончите партию в покер.",
                 "Азарт - это хорошо, но давайте по очереди. Покер ждёт.",
                 "Мультитейблинг с казино запрещён! Вернитесь за стол."
             ];
             await ctx.reply(messages[Math.floor(Math.random() * messages.length)], {
                 reply_to_message_id: ctx.message.message_id
             });
             return;
        }

        // Check for Horse/Redeem commands
        if (ctx.message?.text && (ctx.message.text.startsWith('/horse') || ctx.message.text.startsWith('/redeem'))) {
            const messages = [
                 "Вы сейчас играете в покер!",
                 "Заберите деньги со стола, чтобы играть здесь.",
                 "Покерный стол не отпускает?"
             ];
             await ctx.reply(messages[Math.floor(Math.random() * messages.length)], {
                 reply_to_message_id: ctx.message.message_id
             });
             return;
        }
    }
    return next();
});

bot.command("__debug", async (ctx) => {
  await ctx.reply(
    Object.entries({
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
    })
      .map(([key, value]) => `${key} : ${value}`)
      .join("\n"),
    {
      reply_to_message_id: ctx.message?.message_id,
    },
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(locales.help(), {
    reply_to_message_id: ctx.update.message?.message_id,
  });
});

// init
dice(bot);
redeemCode(bot);
horses(bot);
// init end

bot.command("top", async (ctx) => {
  const users = await kv.list<UserState>({ prefix: [CURRENT_KEY] });

  const usersTop: UserState[] = [];

  for await (const user of users) {
    const pokerBalance = gameManager.getUserPokerBalance(parseInt(user.key[user.key.length - 1] as string));
    usersTop.push({ ...user.value, coins: user.value.coins + pokerBalance });
  }

  usersTop.sort((a, b) => b.coins - a.coins);

  const usersTopStrings = usersTop
    .slice(0, 20)
    .map((user, index) => `${index + 1}. ${user.displayName} - ${user.coins}`);

  await ctx.reply([locales.topPlayers(), ...usersTopStrings].join("\n"), {
    reply_to_message_id: ctx.update.message?.message_id,
  });
});

bot.command("balance", async (ctx) => {
  const id = ctx.from?.id;
  if (!id) return;

  const user = await getUserStateSafe(ctx);
  const pokerBalance = gameManager.getUserPokerBalance(id);

  await ctx.reply(locales.yourBalance(user!.coins + pokerBalance), {
    reply_to_message_id: ctx.update.message?.message_id,
    parse_mode: "HTML",
  });
});

bot.errorHandler = (error) => {
  console.error("Error happened: ", error);
};

logStart();

// We initialize webhook handler lazy to avoid conflict with polling
let handleUpdate: ReturnType<typeof webhookCallback> | null = null;

// Start Server (Mini App + WebSocket + Webhook if PROD)
console.log("Starting Web Server...");
Bun.serve({
  port: 3000,
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket Upgrade
    if (url.pathname === '/ws') {
       console.log('WS: Upgrade Request received');
       const initData = url.searchParams.get('initData');
       if (!initData) {
           console.log('WS: Missing initData');
           return new Response('Missing initData', { status: 401 });
       }

       try {
           const user = validateWebAppData(initData, bot.token);
           console.log(`WS: Auth success for ${user.id} (${user.first_name})`);

           if (server.upgrade(req, { data: { user } })) {
               console.log('WS: Upgrade success');
               return undefined;
           } else {
               console.error('WS: Upgrade returned false');
           }
       } catch (e) {
           console.error('WS Auth Failed:', e);
           return new Response('Unauthorized', { status: 401 });
       }
       return new Response('Upgrade failed', { status: 500 });
    }

    // Serve Static Frontend
    if (url.pathname.startsWith('/app')) {
      let filePath = url.pathname.replace('/app', '');
      if (filePath === '' || filePath === '/') filePath = '/index.html';
      if (filePath.includes('..')) return new Response('Forbidden', { status: 403 });

      const file = Bun.file(`./dist/frontend${filePath}`);
      if (await file.exists()) {
           return new Response(file);
      } else {
           if (!filePath.match(/\.(js|css|png|jpg|svg)$/)) {
                const index = Bun.file('./dist/frontend/index.html');
                if (await index.exists()) return new Response(index);
           }
      }
      return new Response('Not Found', { status: 404 });
    }

    // Telegram Webhook (Only processed if IS_PRODUCTION)
    if (IS_PRODUCTION && req.method === "POST" && url.pathname.slice(1) === bot.token) {
      try {
        if (!handleUpdate) handleUpdate = webhookCallback(bot, "std/http");
        return await handleUpdate(req);
      } catch (err) {
        console.error(err);
        return new Response("Error", { status: 500 });
      }
    }

    return new Response("Busino Poker Server OK");
  },
  websocket: {
      open(ws) {
          // @ts-ignore
          const user = ws.data.user;
          console.log(`WS Connected: ${user.id} (${user.first_name})`);
          gameManager.handleConnection(ws);
      },
      message(ws, message) {
          // @ts-ignore
          const user = ws.data.user;
          gameManager.processMessage(ws, message, user);
      },
      close(ws, code, message) {
          // @ts-ignore
          const user = ws.data.user;
          console.log(`WS Closed: ${user.id} code=${code} msg=${message}`);
          gameManager.handleDisconnect(user.id);
      }
  }
});

if (IS_PRODUCTION) {
  console.log("Production Mode: Listening on WebHook...");
  // Webhook handled in fetch
} else {
  console.log("Development Mode: Starting Long Polling...");
  // Clear any existing webhook to ensure polling works
  bot.api.deleteWebhook()
    .then(() => {
        console.log("Webhook deleted. Starting polling...");
        return bot.start({
            onStart: (info) => {
                console.log(`Bot started! @${info.username} (ID: ${info.id})`);
            }
        });
    })
    .catch((err) => {
        console.error("FATAL: Failed to start polling:", err);
    });
}
