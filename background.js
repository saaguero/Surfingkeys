chrome.commands.onCommand.addListener(function(command) {
    switch (command) {
        case 'restartext':
            chrome.runtime.reload();
            break;
        default:
            break;
    }
});

var initialSettings = {
    'maxResults': 500,
    'blacklist': {},
    'marks': {},
    'version': chrome.runtime.getManifest().version,
    'storage': 'local'
};

var Service = {
    'activePorts': [],
    'topOrigins': {},
    'settings': ""
};

function request(method, url) {
    return new Promise(function(acc, rej) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url);
        xhr.onload = function() {
            acc(xhr.responseText);
        };
        xhr.onerror = rej.bind(null, xhr);
        xhr.send();
    });
}
chrome.storage.local.get(null, function(data) {
    if (!data.version || data.version !== initialSettings.version) {
        chrome.storage.local.clear();
        chrome.storage.sync.clear();
        Service.settings = JSON.parse(JSON.stringify(initialSettings));
        var s = request('get', chrome.extension.getURL('/pages/default.js'));
        s.then(function(resp) {
            Service.settings.snippets = resp;
        });
    } else {
        Service.settings = data;
        if (data.storage === 'sync') {
            chrome.storage.sync.get(null, function(data) {
                if (chrome.runtime.lastError) {
                    console.log(chrome.runtime.lastError);
                } else {
                    Service.settings = data;
                    Service.settings.storage = "sync";
                }
            });
        }
    }
});
Service.nextTab = function(message, sender, sendResponse) {
    var tab = sender.tab;
    chrome.tabs.query({
        windowId: tab.windowId
    }, function(tabs) {
        return chrome.tabs.update(tabs[(((tab.index + 1) % tabs.length) + tabs.length) % tabs.length].id, {
            active: true
        });
    });
};
Service.previousTab = function(message, sender, sendResponse) {
    var tab = sender.tab;
    chrome.tabs.query({
        windowId: tab.windowId
    }, function(tabs) {
        return chrome.tabs.update(tabs[(((tab.index - 1) % tabs.length) + tabs.length) % tabs.length].id, {
            active: true
        });
    });
};
Service.reloadTab = function(message, sender, sendResponse) {
    chrome.tabs.reload({
        bypassCache: message.nocache
    });
};
Service.closeTab = function(message, sender, sendResponse) {
    chrome.tabs.query({
        currentWindow: true
    }, function(tabs) {
        var sortedIds = tabs.map(function(e) {
            return e.id;
        });
        var base = sender.tab.index;
        if (message.repeats > sortedIds.length - base) {
            base -= message.repeats - (sortedIds.length - base);
        }
        if (base < 0) {
            base = 0;
        }
        chrome.tabs.remove(sortedIds.slice(base, base + message.repeats));
    });
};
Service.openLast = function(message, sender, sendResponse) {
    for (var i = 0; i < message.repeats; i++) {
        chrome.sessions.restore();
    }
};
Service.duplicateTab = function(message, sender, sendResponse) {
    for (var i = 0; i < message.repeats; i++) {
        chrome.tabs.duplicate(sender.tab.id);
    }
};
Service.getBookmarks = function(message, sender, sendResponse) {
    if (message.parentId) {
        chrome.bookmarks.getSubTree(message.parentId, function(tree) {
            var bookmarks = tree[0].children;
            if (message.query && message.query.length) {
                bookmarks = bookmarks.filter(function(b) {
                    return b.title.indexOf(message.query) !== -1 || (b.url && b.url.indexOf(message.query) !== -1);
                });
            }
            sendResponse({
                type: message.action,
                bookmarks: bookmarks
            });
        });
    } else {
        if (message.query && message.query.length) {
            chrome.bookmarks.search(message.query, function(tree) {
                sendResponse({
                    type: message.action,
                    bookmarks: tree
                });
            });
        } else {
            chrome.bookmarks.getTree(function(tree) {
                sendResponse({
                    type: message.action,
                    bookmarks: tree[0].children
                });
            });
        }
    }
};
Service.getHistory = function(message, sender, sendResponse) {
    chrome.history.search(message.query, function(tree) {
        sendResponse({
            type: message.action,
            history: tree
        });
    });
};
Service.getURLs = function(message, sender, sendResponse) {
    chrome.bookmarks.search(message.query, function(tree) {
        var bookmarks = tree;
        var vacancy = message.maxResults - bookmarks.length;
        if (vacancy > 0) {
            chrome.history.search({
                'text': message.query,
                startTime: 0,
                maxResults: vacancy
            }, function(tree) {
                sendResponse({
                    type: message.action,
                    urls: tree.concat(bookmarks)
                });
            });
        } else {
            sendResponse({
                type: message.action,
                urls: bookmarks
            });
        }
    });
};
Service.openLink = function(message, sender, sendResponse) {
    if (message.tab.tabbed) {
        for (var i = 0; i < message.repeats; ++i) {
            chrome.tabs.create({
                url: message.url,
                active: message.tab.active,
                pinned: message.tab.pinned
            });
        }
    } else {
        chrome.tabs.update({
            url: message.url,
            pinned: message.tab.pinned || sender.tab.pinned
        });
    }
};
Service.viewSource = function(message, sender, sendResponse) {
    message.url = 'view-source:' + sender.tab.url;
    Service.openLink(message, sender, sendResponse);
};
Service.getSettings = function(message, sender, sendResponse) {
    sendResponse({
        type: message.action,
        settings: Service.settings
    });
};
Service.editSettings = function(message, sender, sendResponse) {
    message.url = chrome.extension.getURL('/pages/options.html');
    Service.openLink(message, sender, sendResponse);
};
Service.updateSettings = function(message, sender, sendResponse) {
    for (var sd in message.settings) {
        Service.settings[sd] = message.settings[sd];
    }
    chrome.storage.local.set(Service.settings);
    if (Service.settings.storage === 'sync') {
        chrome.storage.sync.set(Service.settings, function() {
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError);
            }
        });
    }
    Service.activePorts.forEach(function(port) {
        port.postMessage({
            type: 'settingsUpdated',
            settings: Service.settings
        });
    });
};
Service.changeSettingsStorage = function(message, sender, sendResponse) {
    Service.settings.storage = message.storage;
    chrome.storage.local.set(Service.settings);
    if (Service.settings.storage === 'sync') {
        chrome.storage.sync.set(Service.settings, function() {
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError);
            }
        });
    }
};
Service.setSurfingkeysIcon = function(message, sender, sendResponse) {
    chrome.browserAction.setIcon({
        path: (message.status ? 'icons/48-x.png' : 'icons/48.png'),
        tabId: sender.tab.id
    });
};
Service.request = function(message, sender, sendResponse) {
    var s = request(message.method, message.url);
    s.then(function(res) {
        sendResponse({
            type: message.action,
            id: message.id,
            text: res
        });
    });
};
Service.setTopOrigin = function(message, sender, sendResponse) {
    Service.topOrigins[sender.tab.id] = message.topOrigin;
};
Service.getTopOrigin = function(message, sender, sendResponse) {
    sendResponse({
        type: message.action,
        topOrigin: (sender.tab ? Service.topOrigins[sender.tab.id] : "NONE")
    });
};

function handleMessage(_message, _sender, _sendResponse, _port) {
    if (Service.hasOwnProperty(_message.action)) {
        _message.repeats = _message.repeats || 1;
        Service[_message.action](_message, _sender, _sendResponse);
    } else {
        var type = _port ? "[unexpected port message] " : "[unexpected runtime message] ";
        console.log(type + JSON.stringify(_message))
    }
}
chrome.runtime.onMessage.addListener(handleMessage);
chrome.extension.onConnect.addListener(function(port) {
    Service.activePorts.push(port);
    port.postMessage({
        type: 'connected',
        settings: Service.settings,
        extension_id: chrome.i18n.getMessage("@@extension_id")
    });
    port.onMessage.addListener(function(message) {
        return handleMessage(message, port.sender, port.postMessage.bind(port), port);
    });
    port.onDisconnect.addListener(function() {
        for (var i = 0; i < Service.activePorts.length; i++) {
            if (Service.activePorts[i] === port) {
                Service.activePorts.splice(i, 1);
                break;
            }
        }
    });
});
