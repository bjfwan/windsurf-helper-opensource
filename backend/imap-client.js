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

        // 先不限发件人，只按时间搜索，看看有没有邮件进来
        const since = new Date(afterTime - 60 * 1000); // 往前多找1分钟
        console.log(`[IMAP] 搜索 ${since.toISOString()} 之后的所有邮件`);

        imap.search(
          [['SINCE', since]],
          async (err, allUids) => {
            if (err) {
              console.error('[IMAP] 搜索失败:', err.message);
              imap.end();
              return resolve(null);
            }

            console.log(`[IMAP] 时间范围内共 ${allUids.length} 封邮件, uids:`, allUids);

            if (allUids.length === 0) {
              imap.end();
              return resolve(null);
            }

            // 取最新5封，读完整内容，在代码里过滤发件人
            const recent = allUids.slice(-5);
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

                  console.log(`[IMAP] From: ${from} | Subject: ${subject} | To: ${toAddr}`);

                  // 过滤：必须是 windsurf 发的
                  if (!from.includes('windsurf') && !from.includes('codeium')) {
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
