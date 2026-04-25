/**
 * QQ 邮箱 IMAP 客户端
 * 通过 IMAP 协议连接 QQ 邮箱，搜索并提取 Windsurf 验证码
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');

/**
 * 从 QQ 邮箱中查找指定邮箱地址收到的 Windsurf 验证码
 *
 * @param {object} config        - BACKEND_CONFIG
 * @param {string} targetEmail   - 注册时使用的邮箱（通过 CF 转发到 QQ）
 * @param {number} afterTime     - 只查找此时间戳之后的邮件（毫秒）
 * @returns {string|null}        - 验证码，或 null
 */
async function checkCodeFromQQMail(config, targetEmail, afterTime) {
  // 决策理由：targetEmail 必须严格匹配，否则 inbox 里上一次注册的旧邮件会被误返回。
  // CF Email Routing 转发后 To 头依然是原始 windsurf-xxx@yourdomain，可以直接对比。
  const targetFull = String(targetEmail || '').toLowerCase().trim();
  const targetLocal = targetFull.split('@')[0];

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.QQ_EMAIL,
      password: config.QQ_AUTH_CODE,   // QQ 邮箱授权码，不是 QQ 密码
      host: 'imap.qq.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000
    });

    imap.once('ready', () => {
      console.log('[IMAP] ✅ 连接成功');
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          console.error('[IMAP] 打开收件箱失败:', err.message);
          imap.end();
          return resolve(null);
        }

        console.log(`[IMAP] 收件箱共 ${box.messages.total} 封邮件`);

        // 决策理由：回看 60s 是为了容忍主机/邮件服务器之间的时钟漂移；
        // 避免拿到旧验证码靠"客户端拉回邮件后再按 To: + 时间戳过滤"——
        // 不再用服务器侧 ['TO', ...] 条件：实测 QQ IMAP 对 To 字段的索引/匹配方式
        // 与 RFC 3501 行为不一致（local-part 子串过滤会把所有匹配邮件也过滤掉），
        // 改成"宽搜+窄查"模式更稳。
        const since = new Date(afterTime - 60 * 1000);
        console.log(`[IMAP] 搜索 ${since.toISOString()} 之后的邮件，目标 To=${targetFull}`);

        const searchCriteria = [['SINCE', since]];

        imap.search(
          searchCriteria,
          async (err, allUids) => {
            if (err) {
              console.error('[IMAP] 搜索失败:', err.message);
              imap.end();
              return resolve(null);
            }

            console.log(`[IMAP] 命中 ${allUids.length} 封 (uids: ${allUids.join(',') || '空'})`);

            if (allUids.length === 0) {
              imap.end();
              return resolve(null);
            }

            // 决策理由：现在没有服务器侧 To 过滤兜底，需要拉更多邮件做客户端过滤。
            // 取最新 15 封做窄查，覆盖"短时间内多次注册导致 inbox 同时存在多封 windsurf 邮件"的场景。
            const recent = allUids.slice(-15);
            const fetch = imap.fetch(recent, { bodies: '' });
            const mails = [];

            fetch.on('message', (msg) => {
              let buf = '';
              msg.on('body', (stream) => {
                stream.on('data', (chunk) => { buf += chunk.toString('utf8'); });
                stream.once('end', () => { mails.push(buf); });
              });
            });

            fetch.once('error', () => { imap.end(); resolve(null); });

            fetch.once('end', async () => {
              imap.end();

              for (const raw of mails.reverse()) {
                try {
                  const parsed = await simpleParser(raw);
                  const from = (parsed.from?.text || '').toLowerCase();
                  const subject = (parsed.subject || '').toLowerCase();
                  const toAddr = (parsed.to?.text || '').toLowerCase();
                  const mailDate = parsed.date ? parsed.date.getTime() : 0;

                  console.log(`[IMAP] From: ${from} | Subject: ${subject} | To: ${toAddr} | Date: ${parsed.date?.toISOString?.() || 'n/a'}`);

                  // 1) 必须是 windsurf 发的
                  if (!from.includes('windsurf') && !from.includes('codeium')) {
                    continue;
                  }

                  // 2) 必须发给当前监控的目标邮箱（否则会拿到上一个账号的旧验证码）
                  if (targetFull && !toAddr.includes(targetFull) && !toAddr.includes(targetLocal)) {
                    console.log(`[IMAP] 跳过：To 不匹配 ${targetEmail}`);
                    continue;
                  }

                  // 3) 邮件时间必须在监控开始之后 60s 容差之内，避免拿到上一轮残留邮件
                  if (mailDate && mailDate < afterTime - 60 * 1000) {
                    console.log(`[IMAP] 跳过：邮件时间 ${parsed.date.toISOString()} 早于监控开始`);
                    continue;
                  }

                  const body = parsed.text || parsed.html || '';
                  const code = extractCode(body);
                  console.log(`[IMAP] 提取验证码: ${code}`);

                  if (code) return resolve(code);
                } catch (e) {
                  console.error('[IMAP] 解析邮件失败:', e.message);
                }
              }

              resolve(null);
            });
          }
        );
      });
    });

    imap.once('error', (err) => {
      console.error('[IMAP] 连接错误:', err.message);
      reject(err);
    });

    imap.once('end', () => {
      // 连接结束，正常
    });

    imap.connect();
  });
}

/**
 * 从邮件正文中提取 6 位验证码
 */
function extractCode(text) {
  if (!text) return null;

  // 去除 HTML 标签
  const plain = text.replace(/<[^>]+>/g, ' ');

  const patterns = [
    /verification code[:\s]+(\d{6})/i,
    /your code[:\s]+(\d{6})/i,
    /code is[:\s]+(\d{6})/i,
    /\b(\d{6})\b/
  ];

  for (const pattern of patterns) {
    const match = plain.match(pattern);
    if (match) return match[1];
  }

  return null;
}

module.exports = { checkCodeFromQQMail };
