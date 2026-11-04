// Uakinogo online — плагін для Lampa
(function () {
  'use strict';

  if (window.plugin_uakinogo_ready) return;
  window.plugin_uakinogo_ready = true;

  var VERSION = '04.11.2026.3';
  var COMP = 'uakinogo';
  var DEBUG = true; // true — виводити логи в консоль (префікс UAKINO)

  function log() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('UAKINO');
    try { console.log.apply(console, args); } catch (e) {}
  }

  var Utils = {
    host: function () {
      return (Lampa.Storage.get('uakinogo_host', 'https://uakinogo.io') + '').replace(/\/+$/, '');
    },
    proxy: function () {
      if (Lampa.Storage.field('uakinogo_proxy') !== true) return '';
      return (Lampa.Storage.get('uakinogo_proxy_url', '') + '').trim();
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
    // URL пошуку сайту: /search/<запит>
    searchUrl: function (q) {
      return this.host() + '/search/' + encodeURIComponent(q);
    },
    // абсолютний URL з відносного / протокол-відносного
    abs: function (url) {
      url = (url || '') + '';
      if (/^https?:\/\//i.test(url)) return url;
      if (url.indexOf('//') === 0) return 'https:' + url;
      return this.host() + (url.charAt(0) === '/' ? '' : '/') + url;
    },
    // безпечний парсинг HTML без завантаження картинок/скриптів
    parseHtml: function (html) {
      try {
        var doc = new DOMParser().parseFromString((html || '') + '', 'text/html');
        return $(doc.body);
      } catch (e) {
        log('parseHtml error', e);
        return $('<div></div>');
      }
    },
    // витягує посилання на потоки: підтримує [1080p]url,[720p]url та одиночні url
    extractStreams: function (str) {
      str = ((str || '') + '').replace(/\\\//g, '/').replace(/\\u0026/g, '&');
      var map = {}, order = [], m;
      var re = /\[([^\]]+)\]\s*(https?:\/\/[^\s,"'\\\[\]]+\.m3u8[^\s,"'\\\[\]]*)/gi;

      while ((m = re.exec(str))) {
        if (!map[m[1]]) { map[m[1]] = m[2]; order.push(m[1]); }
      }

      if (!order.length) {
        var plain = str.match(/https?:\/\/[^\s,"'\\\[\]]+\.m3u8[^\s,"'\\\[\]]*/i);
        if (plain) { map['Auto'] = plain[0]; order.push('Auto'); }
      }

      if (!order.length) {
        var f = str.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
        if (f) { map['Auto'] = f[1]; order.push('Auto'); }
      }

      if (!order.length) return null;

      // сортуємо за якістю (від більшої до меншої)
      order.sort(function (a, b) { return (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0); });
      var sorted = {};
      order.forEach(function (k) { sorted[k] = map[k]; });

      return { url: sorted[order[0]], quality: sorted, label: order[0] };
    }
  };

  var CARD_SELECTORS = '.shortStory, .shortstory, .movie-item, .short-item, .th-item, article';

  function uakinogo_source(component, _object) {
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

      var full = object.clarification ? [object.search] : Utils.unique([
        object.search, object.search_one, object.search_two,
        movie.title, movie.name, movie.original_title, movie.original_name
      ]);

      // запасні варіанти: назва до двокрапки ("Человек-паук: ..." -> "Человек-паук")
      var short = [];
      if (!object.clarification) {
        full.forEach(function (q) {
          var s = (q + '').split(':')[0].trim();
          if (s && s !== q) short.push(s);
        });
      }

      var queries = Utils.unique(full.concat(short));
      log('queries', queries);

      function runQuery(i) {
        if (destroyed) return;
        if (i >= queries.length) return component.emptyForQuery(select_title);

        var q = (queries[i] || '').replace(/\s+/g, ' ').trim();
        var url = Utils.searchUrl(q);
        log('search', i, url);

        request(url, function (html) {
          var list = parseSearch(html);
          log('html len', (html || '').length, 'found', list.length);

          if (list.length) showResults(list);
          else runQuery(i + 1);
        }, function () {
          runQuery(i + 1);
        });
      }

      runQuery(0);
    };

    function parseSearch(html) {
      var dom = Utils.parseHtml(html);
      var list = [];

      var scope = dom.find('#dle-content');
      if (!scope.length) scope = dom;

      var items = scope.find(CARD_SELECTORS).filter(function () {
        return $(this).closest('header, footer, nav, aside, .sidebar, .menu').length === 0;
      });

      // запасний варіант: посилання на .html усередині основного контенту
      if (!items.length) {
        items = scope.find('a[href*=".html"]').filter(function () {
          return $(this).closest('header, footer, nav, aside, .sidebar, .menu').length === 0 &&
            $(this).text().trim().length > 3;
        });
      }

      items.each(function () {
        var el = $(this);
        var a = el.is('a') ? el : el.find('.hTitle a[href*=".html"]').first();
        if (!a.length) a = el.find('a[href*=".html"]').first();
        if (!a.length) a = el.find('a[href]').first();

        var href = a.attr('href');
        var title = (a.attr('title') || a.text() || '') + '';
        title = title.replace(/\s+/g, ' ').trim().slice(0, 120);

        if (!href || href.charAt(0) === '#' || title.length < 2) return;

        var url = Utils.abs(href);
        var exists = list.some(function (item) { return item.url === url; });
        if (!exists) list.push({ title: title, url: url });
      });

      return list;
    }

    function showResults(list) {
      results = list;
      var movie = object.movie || {};
      var year = ((movie.release_date || movie.first_air_date || '') + '').slice(0, 4);
      var pick = list[0];

      // якщо серед результатів є назва з роком фільму — беремо її, інакше перший результат
      if (year) {
        var byYear = list.filter(function (r) { return r.title.indexOf('(' + year + ')') !== -1; });
        if (byYear.length) pick = byYear[0];
      }

      log('pick', pick.title, pick.url);
      loadMedia(pick.url);
    }

    function loadMedia(url) {
      component.activity.loader(true);
      log('loadMedia', url);
      request(Utils.abs(url), parsePage, function () {
        component.empty();
      });
    }

    function parsePage(html) {
      var dom = Utils.parseHtml(html);
      var iframe = dom.find('iframe[src*="cinemar"], iframe[data-src*="cinemar"], iframe[src*="cinemap"], iframe[data-src*="cinemap"], iframe.player-container').first();
      var iframe_src = iframe.attr('src') || iframe.attr('data-src');

      if (!iframe_src) {
        var match = (html || '').replace(/\\\//g, '/').match(/(https?:\/\/[^"'\s]*(?:cinemar|cinemap)[^"'\s]*)/i);
        if (match) iframe_src = match[1];
      }

      log('iframe', iframe_src);

      if (iframe_src) loadCinemarStream(Utils.abs(iframe_src));
      else component.emptyForQuery(select_title);
    }

    function loadCinemarStream(iframe_url) {
      var headers = { 'Referer': Utils.host() + '/' };

      request(iframe_url, function (str) {
        var found = Utils.extractStreams(str);
        log('iframe html len', (str || '').length, 'stream', found && found.url);

        if (!found) {
          log('iframe head', (str || '').slice(0, 1500));
          return component.emptyForQuery(select_title);
        }

        var movie = object.movie || {};
        var episodes = [{
          title: movie.title || movie.name || select_title,
          file: found.url,
          qualities: found.quality,
          quality: found.label,
          season: 1,
          episode: 1
        }];

        component.loading(false);
        append(episodes);
      }, function () {
        component.emptyForQuery(select_title);
      }, headers);
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
        var item = Lampa.Template.get('uakinogo_folder', {
          title: r.title,
          quality: '',
          info: ''
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
        var back = Lampa.Template.get('uakinogo_folder', {
          title: '← ' + Lampa.Lang.translate('uakinogo_results'),
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
        var item = Lampa.Template.get('uakinogo', element);

        if (viewed.indexOf(hash_file) !== -1) {
          item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
        }

        item.on('hover:enter', function (event, options) {
          if (object.movie && object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
          if (!element.file) return Lampa.Noty.show(Lampa.Lang.translate('uakinogo_nolink'));

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
    Lampa.Template.add('uakinogo',
      '<div class="online selector"><div class="online__body">' +
      '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#fff;">UA</div>' +
      '<div class="online__title" style="padding-left:2.1em;">{title}</div>' +
      '<div class="online__quality" style="padding-left:3.4em;">{quality}</div>' +
      '</div></div>');

    Lampa.Template.add('uakinogo_folder',
      '<div class="online selector"><div class="online__body">' +
      '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#fff;">📁</div>' +
      '<div class="online__title" style="padding-left:2.1em;">{title}</div>' +
      '<div class="online__quality" style="padding-left:3.4em;">{info}</div>' +
      '</div></div>');
  }

  function initLang() {
    Lampa.Lang.add({
      uakinogo_title: { ru: 'Uakinogo', uk: 'Uakinogo', en: 'Uakinogo' },
      uakinogo_watch: { ru: 'Смотреть онлайн (Uakinogo)', uk: 'Дивитись онлайн (Uakinogo)', en: 'Watch online (Uakinogo)' },
      uakinogo_results: { ru: 'Результаты поиска', uk: 'Результати пошуку', en: 'Search results' },
      uakinogo_nolink: { ru: 'Не удалось извлечь ссылку', uk: 'Не вдалося отримати посилання', en: 'Failed to get the link' },
      uakinogo_empty: { ru: 'ничего не найдено', uk: 'нічого не знайдено', en: 'nothing found' },
      uakinogo_host: { ru: 'Адрес сайта', uk: 'Адреса сайту', en: 'Site host' },
      uakinogo_proxy: { ru: 'Использовать CORS-прокси', uk: 'Використовувати CORS-проксі', en: 'Use CORS proxy' },
      uakinogo_proxy_url: { ru: 'URL прокси', uk: 'URL проксі', en: 'Proxy URL' }
    });
  }

  function component(object) {
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var source = new uakinogo_source(this, object);
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
      this.empty(Lampa.Lang.translate('uakinogo_results') + ' (' + query + '): ' + Lampa.Lang.translate('uakinogo_empty'));
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
      icon: '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/><text x="40" y="75" fill="white" font-size="40">UA</text></svg>',
      name: 'Uakinogo - ' + VERSION
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: { name: 'uakinogo_host', type: 'input', values: '', 'default': 'https://uakinogo.io' },
      field: { name: Lampa.Lang.translate('uakinogo_host') }
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: { name: 'uakinogo_proxy', type: 'trigger', 'default': false },
      field: { name: Lampa.Lang.translate('uakinogo_proxy') }
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: { name: 'uakinogo_proxy_url', type: 'input', values: '', 'default': '' },
      field: {
        name: Lampa.Lang.translate('uakinogo_proxy_url'),
        description: 'Префікс, до якого додається повний URL запиту'
      }
    });
  }

  function loadOnline(object) {
    resetTemplates();
    Lampa.Component.add(COMP, component);
    Lampa.Activity.push({
      url: '',
      title: Lampa.Lang.translate('uakinogo_title'),
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
      name: Lampa.Lang.translate('uakinogo_title') + ' - ' + VERSION,
      description: Lampa.Lang.translate('uakinogo_watch'),
      component: COMP,
      onContextMenu: function () {
        return {
          name: Lampa.Lang.translate('uakinogo_watch'),
          description: ''
        };
      },
      onContextLauch: function (object) {
        loadOnline(object);
      }
    };

    Lampa.Manifest.plugins = manifest;

    var button_html =
      '<div class="full-start__button selector view--online uakinogo--button" data-subtitle="' + VERSION + '">' +
      '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="56" stroke="currentColor" stroke-width="12"/><text x="36" y="78" fill="currentColor" font-size="42">UA</text></svg>' +
      '<span>Uakinogo</span></div>';

    Lampa.Listener.follow('full', function (e) {
      // у Lampa подія має назву 'complite' (з помилкою), на випадок виправлення — обидва варіанти
      if (e.type !== 'complite' && e.type !== 'complete') return;

      var render = e.object.activity.render();
      if (render.find('.uakinogo--button').length) return;

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
