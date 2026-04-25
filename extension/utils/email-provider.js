const emailProviders = typeof WindsurfProtocol !== 'undefined' && WindsurfProtocol.emailProviders
  ? WindsurfProtocol.emailProviders
  : {
      tempMail: 'temp-mail',
      backend: 'qq-imap'
    };

function getEmailProviderName(config = {}) {
  return config.provider || config.mode || emailProviders.tempMail;
}

function isTempMailProvider(config = {}) {
  return getEmailProviderName(config) === emailProviders.tempMail;
}

function normalizeEmailProviderConfig(config = {}) {
  const provider = getEmailProviderName(config);
  const tempMail = config.tempMail || {};
  const qqImap = config.qqImap || {};

  if (provider === emailProviders.tempMail) {
    return {
      provider,
      source: 'temp-mail',
      prefix: tempMail.prefix || 'windsurf',
      domain: tempMail.domain || 'tempr.email',
      pollInterval: tempMail.pollInterval || 5000,
      maxAttempts: tempMail.maxAttempts || 60,
      tempMail
    };
  }

  return {
    provider,
    source: 'backend',
    prefix: qqImap.emailPrefix || 'windsurf',
    domain: qqImap.domain || '',
    pollInterval: qqImap.pollInterval || 5000,
    timeout: qqImap.timeout || 120000,
    apiBaseUrl: qqImap.apiBaseUrl || '',
    apiKey: qqImap.apiKey || '',
    qqImap
  };
}

function createTempMailClient(config = {}) {
  return isTempMailProvider(config) && typeof TempMailClient !== 'undefined'
    ? new TempMailClient(config.tempMail || {})
    : null;
}

function buildEmailAddress(config = {}, suffix = generateRandomString(6)) {
  const normalized = normalizeEmailProviderConfig(config);
  return `${normalized.prefix}-${suffix}@${normalized.domain}`;
}
