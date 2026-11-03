(function () {
'use strict';

/**
* AniLiberty for Lampa — prototype 0.1
* Search anime by the title passed from Lampa, then show AniLiberty releases.
*
* NOTE: API paths and response normalization are isolated in API below.
* This prototype intentionally avoids changing Lampa's global TMDB behavior.
*/
var PLUGIN_NAME = 'AniLiberty';
var API_BASE = 'https://aniliberty.top/api/v1';
var STORAGE_KEY = 'aniliberty';

if (window.ANILIBERTY_PLUGIN_LOADED) return;
window.ANILIBERTY_PLUGIN_LOADED = true;

function request(url, callback, error) {
if (Lampa && Lampa.Reguest) {
var req = new Lampa.Reguest();
req.native(url, callback, error || function () {
notify('AniLiberty: API request failed');
});
} else {
fetch(url).then(function (r) {
if (!r.ok) throw new Error('HTTP ' + r.status);
return r.json();
}).then(callback).catch(error || function () {
notify('AniLiberty: API request failed');
});
}
}

function notify(message) {
if (Lampa && Lampa.Noty) Lampa.Noty.show(message);
else console.log(message);
}

function esc(s) {
return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
return ({ '&': '&', '<': '<', '>': '>', '"': '"' })[c];
});
}

function titleOf(card) {
return card && (card.title || card.name || card.original_title || card.original_name || '');
}

function normalizeSearch(items) {
if (!Array.isArray(items)) {
if (items && Array.isArray(items.data)) items = items.data;
else if (items && Array.isArray(items.items)) items = items.items;
else if (items && Array.isArray(items.list)) items = items.list;
else items = [];
}

return items.map(function (a) {
var names = a.names || a.name || a.title || {};
var title = typeof names === 'string' ? names :
(names.ru || names.en || names.ua || a.title || a.name_ru || a.name || 'Аніме');

return {
id: a.id || a.release_id || a.alias || a.slug,
title: title,
original_title: a.original_title || a.name_jp || a.name_original || title,
poster: a.poster || a.poster_url || a.image || a.cover || (a.poster && a.poster.src) || '',
overview: a.description || a.synopsis || '',
year: a.year || a.release_year || '',
raw: a
};
}).filter(function (a) {
return a.id;
});
}

function searchAnime(query, callback) {
// Public API quick-search endpoint (searches releases by title).
var url = API_BASE + '/app/search/releases?query=' + encodeURIComponent(query);

request(url, function (data) {
callback(normalizeSearch(data));
});
}

function getReleaseDetails(id, callback) {
request(API_BASE + '/anime/releases/' + encodeURIComponent(id), callback);
}

function getEpisodes(release, callback) {
var episodes = release && (release.episodes || release.items || release.series);
callback(Array.isArray(episodes) ? episodes : []);
}

function addPluginSource() {
if (!Lampa || !Lampa.Component || !Lampa.Template || !Lampa.Activity) return;

Lampa.Component.add('aniliberty_search', {
create: function () {
var self = this;

this.render = $`('<div class="category-full"></div>');
this.render.append(
'<div class="selector" style="padding:1em">Пошук AniLiberty…</div>'
);

this.start = function (params) {
self.params = params || {};

var query = self.params.query ||
self.params.title ||
self.params.search ||
'';

if (!query) {
self.render.html(
'<div class="selector" style="padding:1em">' +
'Передайте назву аніме для пошуку.</div>'
);
return;
}

searchAnime(query, function (results) {
self.render.empty();

if (!results.length) {
self.render.append(
'<div class="selector" style="padding:1em">' +
'AniLiberty: нічого не знайдено за «' +
esc(query) + '»</div>'
);
return;
}

results.forEach(function (item) {
var row = `$(
'<div class="selector" style="padding:1em;' +
'display:flex;align-items:center;gap:1em"></div>'
);

if (item.poster) {
row.append(
'<img style="width:5em;height:auto" src="' +
esc(item.poster) + '">'
);
}

row.append(
'<div><div>' + esc(item.title) +
'</div><div style="opacity:.6">' +
esc(item.year) + '</div></div>'
);

row.on('hover:enter', function () {
Lampa.Activity.push({
component: 'aniliberty_anime',
id: item.id,
title: item.title,
item: item
});
});

self.render.append(row);
});
});
};

this.pause = function () {};
this.stop = function () {};
},

render: function () {
return this.render;
}
});

Lampa.Component.add('aniliberty_anime', {
create: function () {
var self = this;

this.render = $`('<div class="category-full"></div>');
this.render.append(
'<div class="selector" style="padding:1em">' +
'Завантаження епізодів…</div>'
);

this.start = function (params) {
self.params = params || {};
var id = self.params.id;

getReleaseDetails(id, function (details) {
getEpisodes(details, function (episodes) {
self.render.empty();

var name = titleOf(self.params.item) ||
self.params.title ||
'Аніме';

if (!episodes.length) {
self.render.append(
'<div class="selector" style="padding:1em">' +
'Релізів не знайдено.</div>'
);
return;
}

episodes.forEach(function (rel) {
var label = rel.name ||
rel.ordinal ||
rel.number ||
rel.title ||
'Епізод';

var row = `$(
'<div class="selector" style="padding:1em"></div>'
).text(label);

row.on('hover:enter', function () {
var url = rel.hls_1080 ||
rel.hls_720 ||
rel.hls_480 ||
rel.url ||
rel.link ||
rel.playlist ||
rel.m3u8;

if (!url) {
notify(
'Поки що цей реліз не має прямого ' +
'посилання для програвача.'
);
return;
}

Lampa.Player.play({
title: name + ' — ' + label,
url: url,
json: rel,
subtitles: rel.subtitles || []
});
});

self.render.append(row);
});
});
});
};

this.pause = function () {};
this.stop = function () {};
},

render: function () {
return this.render;
}
});

// Search entry accessible from Lampa's search screen/menu as a standalone component.
if (Lampa.Menu && Lampa.Menu.add) {
Lampa.Menu.add(PLUGIN_NAME, function () {
Lampa.Activity.push({
component: 'aniliberty_search',
query: '',
title: PLUGIN_NAME
});
});
}
}

function init() {
if (window.Lampa) addPluginSource();
else setTimeout(init, 500);
}

init();
})();