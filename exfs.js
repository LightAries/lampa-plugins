// EX-FS online — плагін для Lampa (ex-fs.net)
(function () {
  'use strict';

  if (window.plugin_exfs_ready) return;
  window.plugin_exfs_ready = true;

  var VERSION = '04.11.2026.2';
  var COMP = 'exfs';
  var DEBUG = true; // true — логи в консоль (префікс EXFS)

  function log() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('EXFS');
    try { console.log.apply(console, args); } catch (e) {}
  }

  var Utils = {
    host: function () {
      return (Lampa.Storage.get('exfs_host', 'https://ex-fs.net') + '').replace(/\/+$/, '');
    },
    proxy: function () {
      if (Lampa.Storage.field('exfs_proxy') !== true) return '';
      return (Lampa.Storage.get('exfs_proxy_url', '') + '').trim();
    },
    proxyUrl: function (url) {
      var p = this.proxy();
      return p ? p + url : url;
    },
    netMethod: function () {
      return Lampa.Platform.is('android') ? 'native' : 'silent';
    },
    unique: function (arr) {
      var res = [];
      arr.forEach(function (s) {
        s = (s || '') + '';
        s = s.trim();
        if (s && res.indexOf(s) === -1) res.push(s);
      });
      return res;
    },
    // нормалізація для порівняння назв
    norm: function (s) {
      return ((s || '') + '').toLowerCase().replace(/ё/g, 'е')
        .replace(/[^a-zа-яіїєґ0-9]+/gi, ' ').trim();
    },
    // DLE-пошук (форма fullsearch — GET)
    searchUrl: function (q) {
      return this.host() + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(q);
    },
    origin: function (url) {
      var m = (url || '').match(/^(https?:\/\/[^\/]+)/i);
      return m ? m[1] : this.host();
    },
    // абсолютний URL; base — сторінка, відносно якої резолвимо (за замовчуванням сайт)
    abs: function (url, base) {
      url = (url || '') + '';
      if (/^https?:\/\//i.test(url)) return url;
      if (url.indexOf('//') === 0) return 'https:' + url;
      var o = base ? this.origin(base) : this.host();
      return o + (url.charAt(0) === '/' ? '' : '/') + url;
    },
    parseHtml: function (html) {
      try {
        var doc = new DOMParser().parseFromString((html || '') + '', 'text/html');
        return $(doc.body);
      } catch (e) {
        log('parseHtml error', e);
        return $('<div></div>');
      }
    },
    // чи схожий URL на рекламний
    isAd: function (u) {
      return /\/x-px|[\/_.\-](ads?|adv|vast|preroll|promo|banner)[\/_.\-]/i.test(u);
    },
    // відносний шлях → абсолютний відносно URL плейлиста
    resolve: function (url, base) {
      url = (url || '') + '';
      if (/^https?:\/\//i.test(url)) return url;
      if (url.indexOf('//') === 0) return 'https:' + url;
      if (url.charAt(0) === '/') return this.origin(base) + url;
      return base.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') + url;
    },
    // всі m3u8-кандидати: чисті першими, interkh.com пріоритетніше
    extractCandidates: function (str) {
      str = ((str || '') + '').replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      var list = [], seen = {}, m, self = this;
      var re = /(?:\[([^\]]+)\]\s*)?(https?:\/\/[^\s,"'\\\[\]<>]+\.m3u8[^\s,"'\\\[\]<>]*)/gi;

      while ((m = re.exec(str))) {
        if (seen[m[2]]) continue;
        seen[m[2]] = true;
        list.push({ label: m[1] || 'Auto', url: m[2] });
      }

      list.forEach(function (c) {
        c.rank = (self.isAd(c.url) ? 10 : 0) + (c.url.indexOf('interkh.com') !== -1 ? 0 : 1);
      });
      list.sort(function (a, b) {
        return (a.rank - b.rank) || ((parseInt(b.label, 10) || 0) - (parseInt(a.label, 10) || 0));
      });
      return list;
    }
  };

  // порядок спроб плеєрів (за підрядком у URL); трейлери пропускаємо
  var PLAYER_PRIORITY = ['uacdn', 'nextembed', 'stloadi'];

  function exfs_source(component, _object) {
    var network = new Lampa.Reguest();
    var object = _object;
    var select_title = '';
    var results = [];
    var destroyed = false;

    function request(url, ok, fail, headers) {
      var params = { dataType: 'text' };
      if (headers) params.headers = headers;
      network.clear();
      network.timeout(15000);
      network[Utils.netMethod()](Utils.proxyUrl(url), function (data) {
        if (destroyed) return;
        ok(data);
      }, function (a, c) {
        if (destroyed) return;
        log('network error', url, a, c);
        fail(a, c);
      }, false, params);
    }

    this.search = function (_object) {
      object = _object;
      var movie = object.movie || {};
      select_title = object.search || movie.title || movie.name || '';

      var titles = Utils.unique([
        object.search, object.search_one, movie.title, movie.name
      ]);
      var origs = Utils.unique([
        object.search_two, movie.original_title, movie.original_name
      ]);

      var full = object.clarification ? [object.search] : Utils.unique(titles.concat(origs));

      // запасні варіанти: назва до двокрапки
      var short = [];
      if (!object.clarification) {
        full.forEach(function (q) {
          var s = (q + '').split(':')[0].trim();
          if (s && s !== q) short.push(s);
        });
      }

      var queries = Utils.unique(full.concat(short));
      var year = ((movie.release_date || movie.first_air_date || '') + '').slice(0, 4);
      var fallback = null;

      log('queries', queries, 'year', year);

      // оцінка збігу результату з фільмом
      function score(r) {
        var s = 0;
        var o = Utils.norm(r.orig);
        if (o && origs.some(function (x) { return Utils.norm(x) === o; })) s += 4;

        var t = Utils.norm(r.title);
        if (t && titles.some(function (x) {
          var n = Utils.norm(x);
          return n.length > 2 && t.indexOf(n) !== -1;
        })) s += 2;

        if (year && r.year && (r.year + '') === year) s += 1;
        return s;
      }

      function best(list) {
        var top = list[0], top_score = -1;
        list.forEach(function (r) {
          var sc = score(r);
          r.score = sc;
          if (sc > top_score) { top = r; top_score = sc; }
        });
        return top;
      }

      function runQuery(i) {
        if (destroyed) return;

        if (i >= queries.length) {
          if (fallback) {
            log('fallback pick', fallback.title, fallback.url);
            return pickResult(fallback);
          }
          return component.emptyForQuery(select_title);
        }

        var q = (queries[i] || '').replace(/\s+/g, ' ').trim();
        var url = Utils.searchUrl(q);
        log('search', i, url);

        request(url, function (html) {
          var list = parseSearch(html);
          log('html len', (html || '').length, 'found', list.length);

          if (!list.length) return runQuery(i + 1);

          results = list;
          var top = best(list);
          log('best', top.title, '|', top.orig, '| score', top.score);

          if (top.score >= 3) return pickResult(top);

          // слабкий збіг — запам'ятовуємо і пробуємо наступний запит
          if (!fallback) fallback = list[0];
          runQuery(i + 1);
        }, function () {
          runQuery(i + 1);
        });
      }

      runQuery(0);
    };

    function pickResult(r) {
      log('pick', r.title, r.url);
      loadMedia(r.url);
    }

    function parseSearch(html) {
      var dom = Utils.parseHtml(html);
      var list = [];

      dom.find('.srx-item').each(function () {
        var el = $(this);
        var a = el.find('.srx-title a').first();
        if (!a.length) a = el.find('a[href*=".html"]').first();

        var href = a.attr('href');
        var title = (a.text() || a.attr('title') || '').replace(/\s+/g, ' ').trim();
        if (!href || title.length < 2) return;

        var url = Utils.abs(href);
        if (list.some(function (x) { return x.url === url; })) return;

        list.push({
          title: title,
          orig: el.find('.srx-orig').first().text().replace(/\s+/g, ' ').trim(),
          year: el.find('.CardYear').first().text().trim(),
          url: url
        });
      });

      // запасний варіант: посилання виду /розділ/12345-назва.html у #dle-content
      if (!list.length) {
        var scope = dom.find('#dle-content');
        if (!scope.length) scope = dom;

        scope.find('a[href]').each(function () {
          var a = $(this);
          var href = a.attr('href') || '';
          var title = a.text().replace(/\s+/g, ' ').trim();
          if (!/\/\d+-[^\/]+\.html/i.test(href) || title.length < 3) return;

          var url = Utils.abs(href);
          if (list.some(function (x) { return x.url === url; })) return;
          list.push({ title: title, orig: '', year: '', url: url });
        });
      }

      return list;
    }

    function loadMedia(url) {
      component.activity.loader(true);
      log('loadMedia', url);
      request(Utils.abs(url), function (html) {
        parsePage(html, url);
      }, function () {
        component.empty();
      });
    }

    // збираємо iframe-плеєри з вкладок .tab-pane
    function parsePage(html, page_url) {
      var dom = Utils.parseHtml(html);
      var players = [];

      dom.find('.tab-pane iframe[src]').each(function () {
        var f = $(this);
        var src = f.attr('src');
        if (!src) return;

        var pane_id = f.closest('.tab-pane').attr('id') || '';
        var name = '';
        if (pane_id) {
          var link = dom.find('a[href="#' + pane_id + '"]').first();
          name = link.clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
        }

        var url = Utils.abs(src, page_url);
        if (/trailer|трейлер/i.test(url + ' ' + name)) return;

        players.push({ name: name || pane_id || 'Player', url: url });
      });

      players.sort(function (a, b) {
        function rank(p) {
          for (var i = 0; i < PLAYER_PRIORITY.length; i++) {
            if (p.url.indexOf(PLAYER_PRIORITY[i]) !== -1) return i;
          }
          return PLAYER_PRIORITY.length;
        }
        return rank(a) - rank(b);
      });

      log('players', players.map(function (p) { return p.name + ' -> ' + p.url; }));

      if (!players.length) return component.emptyForQuery(select_title);
      tryPlayer(players, 0, page_url);
    }

    function tryPlayer(players, i, page_url) {
      if (destroyed) return;
      if (i >= players.length) {
        return component.empty('Потоки не знайдено в жодному плеєрі (дивись консоль: EXFS)');
      }

      var p = players[i];
      log('try player', i, p.name, p.url);

      fetchCandidates(p.url, Utils.host() + '/', 0, function (cands) {
        if (!cands.length) return tryPlayer(players, i + 1, page_url);

        pickReal(cands, p.url, 0, function (found) {
          if (!found) return tryPlayer(players, i + 1, page_url);

          var movie = object.movie || {};
          var episodes = [{
            title: movie.title || movie.name || select_title,
            file: found.url,
            qualities: found.quality,
            quality: p.name + ' · ' + found.label + ' · ' + found.info,
            season: 1,
            episode: 1
          }];

          component.loading(false);
          append(episodes);
        });
      });
    }

    // збирає m3u8-кандидатів з iframe (за потреби — з вкладеного)
    function fetchCandidates(url, referer, depth, cb) {
      request(url, function (str) {
        var list = Utils.extractCandidates(str);
        log('iframe', depth, url, 'len', (str || '').length, 'candidates', list.length);

        if (list.length) return cb(list);

        if (depth < 1) {
          var m = (str || '').match(/<iframe[^>]+src=["']([^"']+)["']/i);
          if (m) return fetchCandidates(Utils.abs(m[1], url), url, depth + 1, cb);
        }

        log('iframe head', (str || '').slice(0, 800));
        cb([]);
      }, function () {
        cb([]);
      }, { 'Referer': referer });
    }

    // перевіряє кандидатів по черзі, відкидає рекламні ролики за тривалістю
    function pickReal(cands, referer, k, cb) {
      if (destroyed) return;
      if (k >= cands.length) return cb(null);

      var c = cands[k];
      var movie = object.movie || {};
      var runtime = movie.runtime || (movie.episode_run_time && movie.episode_run_time[0]) || 0;
      var min_sec = runtime ? runtime * 60 * 0.4 : 300;

      probe(c.url, referer, 0, function (dur) {
        log('probe', c.url, 'duration', dur, 'min', min_sec);

        if (dur === null || dur < min_sec) return pickReal(cands, referer, k + 1, cb);

        var q = {};
        cands.forEach(function (x) {
          if (!Utils.isAd(x.url) && !q[x.label]) q[x.label] = x.url;
        });
        if (!q[c.label]) q[c.label] = c.url;

        cb({ url: c.url, label: c.label, quality: q, info: Math.round(dur / 60) + ' хв' });
      });
    }

    // повертає сумарну тривалість плейлиста в секундах (null — не плейлист/помилка)
    function probe(url, referer, depth, cb) {
      request(url, function (txt) {
        txt = (txt || '') + '';
        if (txt.indexOf('#EXTM3U') === -1) return cb(null);

        // master-плейлист → беремо перший варіант
        var v = txt.match(/#EXT-X-STREAM-INF[^\n]*\n\s*([^\s#][^\n]*)/);
        if (v && depth < 2) return probe(Utils.resolve(v[1].trim(), url), referer, depth + 1, cb);

        var total = 0, m, re = /#EXTINF:([\d.]+)/g;
        while ((m = re.exec(txt))) total += parseFloat(m[1]) || 0;

        cb(total > 0 ? total : null);
      }, function () {
        cb(null);
      }, { 'Referer': referer });
    }

    this.destroy = function () {
      destroyed = true;
      network.clear();
      results = [];
    };

    this.reset = function () {
      component.reset();
      if (results && results.length) appendResults();
    };

    function appendResults() {
      if (!results) return;
      component.reset();
      results.forEach(function (r) {
        var item = Lampa.Template.get('exfs_folder', {
          title: r.title,
          quality: '',
          info: r.orig + (r.year ? ' · ' + r.year : '')
        });
        item.on('hover:enter', function () {
          component.reset();
          loadMedia(r.url);
        });
        component.append(item);
      });
      component.start(true);
    }

    function append(items) {
      component.reset();
      var viewed = Lampa.Storage.cache('online_view', 5000, []);

      if (results && results.length > 1) {
        var back = Lampa.Template.get('exfs_folder', {
          title: '← ' + Lampa.Lang.translate('exfs_results'),
          quality: '',
          info: ''
        });
        back.on('hover:enter', function () {
          appendResults();
        });
        component.append(back);
      }

      items.forEach(function (element) {
        var hash_file = Lampa.Utils.hash([element.season, element.episode, element.title].join(''));
        var item = Lampa.Template.get('exfs', element);

        if (viewed.indexOf(hash_file) !== -1) {
          item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
        }

        item.on('hover:enter', function (event, options) {
          if (object.movie && object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
          if (!element.file) return Lampa.Noty.show(Lampa.Lang.translate('exfs_nolink'));

          var first = {
            url: element.file,
            title: element.title,
            quality: element.qualities || { 'Auto': element.file }
          };

          if (options && options.runas) Lampa.Player.runas(options.runas);
          Lampa.Player.play(first);
          Lampa.Player.playlist([first]);

          if (viewed.indexOf(hash_file) === -1) {
            viewed.push(hash_file);
            item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
            Lampa.Storage.set('online_view', viewed);
          }
        });

        component.append(item);
      });

      component.start(true);
    }
  }

  function resetTemplates() {
    Lampa.Template.add('exfs',
      '<div class="online selector"><div class="online__body">' +
      '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#fff;">FS</div>' +
      '<div class="online__title" style="padding-left:2.1em;">{title}</div>' +
      '<div class="online__quality" style="padding-left:3.4em;">{quality}</div>' +
      '</div></div>');

    Lampa.Template.add('exfs_folder',
      '<div class="online selector"><div class="online__body">' +
      '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#fff;">📁</div>' +
      '<div class="online__title" style="padding-left:2.1em;">{title}</div>' +
      '<div class="online__quality" style="padding-left:3.4em;">{info}</div>' +
      '</div></div>');
  }

  function initLang() {
    Lampa.Lang.add({
      exfs_title: { ru: 'EX-FS', uk: 'EX-FS', en: 'EX-FS' },
      exfs_watch: { ru: 'Смотреть онлайн (EX-FS)', uk: 'Дивитись онлайн (EX-FS)', en: 'Watch online (EX-FS)' },
      exfs_results: { ru: 'Результаты поиска', uk: 'Результати пошуку', en: 'Search results' },
      exfs_nolink: { ru: 'Не удалось извлечь ссылку', uk: 'Не вдалося отримати посилання', en: 'Failed to get the link' },
      exfs_empty: { ru: 'ничего не найдено', uk: 'нічого не знайдено', en: 'nothing found' },
      exfs_host: { ru: 'Адрес сайта', uk: 'Адреса сайту', en: 'Site host' },
      exfs_proxy: { ru: 'Использовать CORS-прокси', uk: 'Використовувати CORS-проксі', en: 'Use CORS proxy' },
      exfs_proxy_url: { ru: 'URL прокси', uk: 'URL проксі', en: 'Proxy URL' }
    });
  }

  function component(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var source = new exfs_source(this, object);
    var last;

    scroll.body().addClass('torrent-list');
    scroll.minus(files.render().find('.explorer__files-head'));

    this.create = function () {
      var _this = this;
      this.activity.loader(true);

      filter.onSearch = function (value) {
        Lampa.Activity.replace({ search: value, search_date: '', clarification: true });
      };
      filter.onBack = function () {
        _this.start();
      };
      filter.onSelect = function () {
        setTimeout(_this.closeFilter, 10);
      };

      filter.set('filter', []);
      filter.chosen('filter', []);
      filter.render().find('.filter--sort').remove();
      files.appendHead(filter.render());
      files.appendFiles(scroll.render());

      source.search(object);
      return this.render();
    };

    this.closeFilter = function () {
      if ($('body').hasClass('selectbox--open')) Lampa.Select.close();
    };

    this.reset = function () {
      last = false;
      scroll.clear();
    };

    this.loading = function (status) {
      if (status) this.activity.loader(true); else {
        this.activity.loader(false);
        this.activity.toggle();
      }
    };

    this.append = function (item) {
      item.on('hover:focus', function (e) {
        last = e.target;
        scroll.update($(e.target), true);
      });
      scroll.append(item);
    };

    this.empty = function (msg) {
      var empty = Lampa.Template.get('list_empty');
      if (msg) empty.find('.empty__descr').text(typeof msg === 'string' ? msg : (msg.message || ''));
      scroll.append(empty);
      this.loading(false);
    };

    this.emptyForQuery = function (query) {
      this.empty(Lampa.Lang.translate('exfs_results') + ' (' + query + '): ' + Lampa.Lang.translate('exfs_empty'));
    };

    this.inActivity = function () {
      var a = Lampa.Activity.active();
      return !!a && a.activity === this.activity;
    };

    this.start = function (first_select) {
      if (!this.inActivity()) return;

      if (first_select) {
        var last_views = scroll.render().find('.selector.online').find('.torrent-item__viewed').parent().last();
        last = last_views.length ? last_views.eq(0)[0] : scroll.render().find('.selector').eq(0)[0];
      }

      Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
      Lampa.Controller.add('content', {
        toggle: function toggle() {
          Lampa.Controller.collectionSet(scroll.render(), files.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        up: function up() {
          if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head');
        },
        down: function down() {
          Navigator.move('down');
        },
        right: function right() {
          if (Navigator.canmove('right')) Navigator.move('right');
        },
        left: function left() {
          if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu');
        },
        back: this.back
      });

      if (this.inActivity()) Lampa.Controller.toggle('content');
    };

    this.render = function () {
      return files.render();
    };

    this.back = function () {
      Lampa.Activity.backward();
    };

    this.pause = function () {};
    this.stop = function () {};

    this.destroy = function () {
      files.destroy();
      scroll.destroy();
      source.destroy();
    };
  }

  var settings_inited = false;

  function initSettings() {
    if (settings_inited) return;
    settings_inited = true;

    Lampa.SettingsApi.addComponent({
      component: COMP,
      icon: '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/><text x="38" y="75" fill="white" font-size="40">FS</text></svg>',
      name: 'EX-FS - ' + VERSION
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: { name: 'exfs_host', type: 'input', values: '', 'default': 'https://ex-fs.net' },
      field: { name: Lampa.Lang.translate('exfs_host') }
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: { name: 'exfs_proxy', type: 'trigger', 'default': false },
      field: { name: Lampa.Lang.translate('exfs_proxy') }
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: { name: 'exfs_proxy_url', type: 'input', values: '', 'default': '' },
      field: {
        name: Lampa.Lang.translate('exfs_proxy_url'),
        description: 'Префікс, до якого додається повний URL запиту'
      }
    });
  }

  function loadOnline(object) {
    resetTemplates();
    Lampa.Component.add(COMP, component);
    Lampa.Activity.push({
      url: '',
      title: Lampa.Lang.translate('exfs_title'),
      component: COMP,
      search: object.title || object.name,
      search_one: object.title || object.name,
      search_two: object.original_title || object.original_name,
      movie: object,
      page: 1
    });
  }

  function initMain() {
    initLang();
    Lampa.Component.add(COMP, component);
    resetTemplates();
    initSettings();

    var manifest = {
      type: 'video',
      version: VERSION,
      name: Lampa.Lang.translate('exfs_title') + ' - ' + VERSION,
      description: Lampa.Lang.translate('exfs_watch'),
      component: COMP,
      onContextMenu: function () {
        return {
          name: Lampa.Lang.translate('exfs_watch'),
          description: ''
        };
      },
      onContextLauch: function (object) {
        loadOnline(object);
      }
    };

    Lampa.Manifest.plugins = manifest;

    var button_html =
      '<div class="full-start__button selector view--online exfs--button" data-subtitle="' + VERSION + '">' +
      '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="56" stroke="currentColor" stroke-width="12"/><text x="34" y="78" fill="currentColor" font-size="42">FS</text></svg>' +
      '<span>EX-FS</span></div>';

    Lampa.Listener.follow('full', function (e) {
      // у Lampa подія називається 'complite' (з помилкою); на випадок виправлення — обидва варіанти
      if (e.type !== 'complite' && e.type !== 'complete') return;

      var render = e.object.activity.render();
      if (render.find('.exfs--button').length) return;

      var btn = $(button_html);
      btn.on('hover:enter', function () {
        loadOnline(e.data.movie);
      });

      var anchor = render.find('.view--torrent').last();
      if (anchor.length) anchor.after(btn);
      else render.find('.full-start-new__buttons, .full-start__buttons').first().append(btn);
    });
  }

  if (window.appready) {
    initMain();
  } else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') initMain();
    });
  }
})();
