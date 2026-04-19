const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require("@whiskeysockets/baileys")
const P = require("pino")

// ================= OWNER =================
const ownerNumber = "81517681425@s.whatsapp.net"

// ================= SYSTEM =================
let onlyAdminMode = false
let limitUser = {}
let spamTracker = {}
let groupExpiry = {}

// ================= START BOT =================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session")

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" })
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) console.log("SCAN QR:", qr)

    if (connection === "close") {
      const reconnect =
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
      if (reconnect) startBot()
    }

    if (connection === "open") {
      console.log("A BOT ACTIVE")
    }
  })

  // ================= HELPERS =================
  async function isAdmin(sock, groupId, user) {
    const meta = await sock.groupMetadata(groupId)
    const member = meta.participants.find(p => p.id === user)
    return member?.admin
  }

  async function getMedia(msg) {
    const stream = await downloadContentFromMessage(
      msg.message.imageMessage || msg.message.videoMessage,
      msg.message.imageMessage ? "image" : "video"
    )

    let buffer = Buffer.from([])
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk])
    }
    return buffer
  }

  // ================= MESSAGE =================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message) return

    const from = msg.key.remoteJid
    const isGroup = from.endsWith("@g.us")
    const sender = msg.key.participant || msg.key.remoteJid

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text

    const pesan = (text || "").toLowerCase()

    if (!pesan.startsWith(".")) return

    // ================= LIMIT =================
    if (!limitUser[sender]) limitUser[sender] = { count: 0, max: 10 }
    if (limitUser[sender].count >= limitUser[sender].max) return
    limitUser[sender].count++

    // ================= AUTO EXPIRE GROUP =================
    if (isGroup) {
      if (!groupExpiry[from]) groupExpiry[from] = Date.now()

      const expireDays = 7
      if (Date.now() - groupExpiry[from] > expireDays * 86400000) {
        await sock.sendMessage(from, { text: "bot expired, keluar group" })
        await sock.groupLeave(from)
        delete groupExpiry[from]
        return
      }
    }

    // ================= ONLY ADMIN MODE =================
    if (isGroup && onlyAdminMode) {
      const admin = await isAdmin(sock, from, sender)
      if (!admin && sender !== ownerNumber) return
    }

    // ================= ANTI LINK =================
    const linkRegex = /https?:\/\/|wa.me|t\.me|www\./gi
    if (linkRegex.test(pesan)) {
      const admin = await isAdmin(sock, from, sender)
      if (!admin) {
        await sock.sendMessage(from, { delete: msg.key })
      }
    }

    // ================= ANTI SPAM =================
    if (!spamTracker[sender]) spamTracker[sender] = []
    spamTracker[sender].push(Date.now())
    spamTracker[sender] = spamTracker[sender].slice(-5)

    if (spamTracker[sender][4] - spamTracker[sender][0] < 3000) {
      return
    }

    // ================= MENU =================
    if (pesan === ".menu all") {
      await sock.sendMessage(from, {
        text: `A BOT MENU

.find menu
.menu game
.menu group
.menu owner

data
limit: ${limitUser[sender].max - limitUser[sender].count}
number: ${sender.split("@")[0]}

owner
bot versi: 1.4
nama bot: a bot`
      })
    }

    if (pesan === ".menu group") {
      await sock.sendMessage(from, {
        text: `.hidetag
.kick
.promote
.demote
.rvo`
      })
    }

    if (pesan === ".menu game") {
      await sock.sendMessage(from, {
        text: `game:
tebak angka`
      })
    }

    if (pesan === ".menu owner") {
      if (sender !== ownerNumber) return
      await sock.sendMessage(from, {
        text: `.admin on
.admin off
.setlimit`
      })
    }

    // ================= ADMIN MODE =================
    if (pesan === ".admin on") {
      if (sender !== ownerNumber) return
      onlyAdminMode = true
      await sock.sendMessage(from, { text: "admin mode on" })
    }

    if (pesan === ".admin off") {
      if (sender !== ownerNumber) return
      onlyAdminMode = false
      await sock.sendMessage(from, { text: "admin mode off" })
    }

    // ================= PROMOTE =================
    if (pesan.startsWith(".promote") && isGroup) {
      const admin = await isAdmin(sock, from, sender)
      if (!admin && sender !== ownerNumber) return

      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
      if (!mentioned) return

      await sock.groupParticipantsUpdate(from, mentioned, "promote")

      await sock.sendMessage(from, {
        text: `selamat @${mentioned[0].split("@")[0]} telah dipromote`,
        mentions: mentioned
      })
    }

    // ================= DEMOTE =================
    if (pesan.startsWith(".demote") && isGroup) {
      const admin = await isAdmin(sock, from, sender)
      if (!admin && sender !== ownerNumber) return

      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
      if (!mentioned) return

      await sock.groupParticipantsUpdate(from, mentioned, "demote")

      await sock.sendMessage(from, {
        text: `@${mentioned[0].split("@")[0]} telah diturunkan`,
        mentions: mentioned
      })
    }

    // ================= HIDETAG =================
    if (pesan.startsWith(".hidetag") && isGroup) {
      const meta = await sock.groupMetadata(from)
      const participants = meta.participants.map(v => v.id)

      await sock.sendMessage(from, {
        text: pesan.replace(".hidetag", ""),
        mentions: participants
      })
    }

    // ================= KICK =================
    if (pesan.startsWith(".kick") && isGroup) {
      if (sender !== ownerNumber) return

      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
      if (!mentioned) return

      await sock.groupParticipantsUpdate(from, mentioned, "remove")
    }

    // ================= STICKER .S =================
    if (pesan === ".s") {
      if (!msg.message.imageMessage) {
        await sock.sendMessage(from, { text: "kirim foto + .s" })
      } else {
        const buffer = await getMedia(msg)
        await sock.sendMessage(from, { sticker: buffer })
      }
    }

    // ================= BRAT =================
    if (pesan.startsWith(".brat ")) {
      const t = pesan.replace(".brat ", "")
      await sock.sendMessage(from, {
        text: "BRAT: " + t
      })
    }

    // ================= RVO (VIEW ONCE BYPASS VERSION) =================
    if (pesan === ".rvo") {
      if (!msg.message.imageMessage && !msg.message.videoMessage) {
        await sock.sendMessage(from, {
          text: "kirim view once atau foto lalu .rvo"
        })
        return
      }

      const buffer = await getMedia(msg)

      if (msg.message.videoMessage) {
        await sock.sendMessage(from, { video: buffer })
      } else {
        await sock.sendMessage(from, { image: buffer })
      }
    }

    // ================= GAME =================
    if (pesan === ".tebak angka") {
      await sock.sendMessage(from, {
        text: "tebak angka 0-9"
      })
    }
  })
}

startBot()