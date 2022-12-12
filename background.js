async function stringToUrl(input) {
    try {
        return new URL(input);
    } catch {}

    try {
        return new URL('http://' + input);
    } catch {}

    return null;
}

const executeScript = (tabId, args, func) =>
    new Promise((resolve) => {
        chrome.scripting.executeScript({ target: { tabId }, args: args, func }, resolve);
    });

const delayExecution = (ms) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
};

const getSavedURL = () => {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get('url', async function (items) {
            if (items.url) {
                resolve(items.url);
            } else {
                resolve('');
            }
        });
    });
};

async function isMacintosh() {
    return navigator.platform.indexOf('Mac') > -1;
}

async function message(tab, message) {
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (message) => {
            alert(message);
        },
        args: [message],
    });
}

// When the user clicks on the extension action
chrome.action.onClicked.addListener(async (tab) => {
    let savedUrl = await getSavedURL();
    console.log(savedUrl);

    const [{ result: urlInput }] = await executeScript(tab.id, [savedUrl], (savedUrl) => {
        console.log(savedUrl);
        return window.prompt('Origin site with SPID:', savedUrl);
    });

    if (!urlInput) {
        return;
    }

    let domain = await stringToUrl(urlInput);
    if (!domain) {
        await message(tab, 'Invalid URL');
        return;
    }

    let complete = false;
    let attempts = 0;
    let session;

    const [{ result: currentUrl }] = await executeScript(tab.id, [], () => {
        return window.location.href;
    });

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [domain.href],
        func: (url) => {
            window.location.replace(url);
        },
    });

    while (complete != true && attempts < 100) {
        const [{ result: sessionInfo }] = await executeScript(
            tab.id,
            [domain.hostname],
            (hostname) => {
                if (window.location.href.includes(hostname)) {
                    return sessionStorage['hasSession-cache'];
                } else {
                    return null;
                }
            }
        );

        if (!sessionInfo) {
            attempts++;
            await delayExecution(200);
        } else {
            session = sessionInfo;
            complete = true;
        }
    }

    if (attempts === 100) {
        await message(tab, 'Failed: Timeout');
        return;
    }

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (url) => {
            window.location.replace(url);
        },
        args: [currentUrl],
    });

    complete = false;
    attempts = 0;

    let spidObject = JSON.parse(session);
    if ('value' in spidObject && 'error' in spidObject.value) {
        await message(tab, 'Failed: SPID not retrived\nAre you logged inn at origin?');
        return;
    }

    while (complete != true && attempts < 100) {
        const [{ result: didComplete }] = await executeScript(
            tab.id,
            [currentUrl, session],
            (currentUrl, session) => {
                if (window.location.href === currentUrl) {
                    sessionStorage['hasSession-cache'] = session;
                    return true;
                } else {
                    return false;
                }
            }
        );

        if (didComplete != true) {
            attempts++;
            await delayExecution(200);
        } else {
            complete = didComplete;
        }
    }

    if (attempts === 100) {
        await message(tab, 'Failed: Timeout');
        return;
    }

    await chrome.storage.sync.set({ url: domain.href }, async function () {});

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            alert('Success: SPID copied');
            window.location.reload();
        },
    });

    return;
});
