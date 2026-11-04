// Uakinogo online — плагін для Lampa (виправлений пошук)
(function () {
  'use strict';

  var VERSION = '03.11.2026.2';
  var COMP = 'uakinogo';
  var online_loading = false;

  var Utils = {
    host: function () {
      return Lampa.Storage.get('uakinogo_host', 'https://uakinogo.io') + '';
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
    }
  };

  function uakinogo_source(component, _object) {
    var network = new Lampa.Reguest();
    var object = _object;
    var select_title = '';
    var results = [];

    this.search = function (_object) {
      object = _object;
      select_title = object.search || object.movie.title;

      var queries = object.clarification ? [object.search] : Utils.unique([
        object.search, object.search_one, object.search_two,
        object.movie.title, object.movie.original_title, object.movie.original_name
      ]);

      function next(i) {
        if (i >= queries.length) return component.emptyForQuery(select_title);
        var clean_query = (queries[i] || '').replace(/[\:\-\!\?]/g, ' ').trim();
        var search_url = Utils.host() + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(clean_query);

        network.clear();
        network.timeout(15000);
        network[Utils.netMethod()](Utils.proxyUrl(search_url), function (html) {
          parseSearch(html, queries, i);
        }, function () {
          next(i + 1);
        }, false, { dataType: 'text' });
      }

      next(0);
    };

    function parseSearch(html, queries, i) {
      var dom = $(html);
      var list = [];

      // Розширений пошук елементів (будь-які картки або посилання на фільми)
      var items = dom.find('.movie-item, .shortstory, article, .item, .short-item, .th-item');
      
      if (items.length === 0) {
        // Запасний варіант: шукаємо всі посилання у контенті, які ведуть на внутрішні сторінки
        items = dom.find('.content a, #dle-content a').filter(function() {
          var href = $(this).attr('href');
          return href && href.indexOf('.html') !== -1 && $(this).text().trim().length > 3;
        });
      }

      items.each(function () {
        var el = $(this);
        var title_el = el.find('.movie-title, .title, h2, h3').first();
        var title = title_el.length ? title_el.text().trim() : el.text().trim();
        var href = el.is('a') ? el.attr('href') : el.find('a').attr('href');

        if (href && title && title.length > 2) {
          // Захист від дублікатів
          var exists = list.some(function(item) { return item.url === href; });
          if (!exists) {
            list.push({
              title: title,
              url: href,
              id: href
            });
          }
        }
      });

      if (list.length > 0) {
        results = list;
        component.loading(false);
        if (list.length === 1) {
          loadMedia(list[0].url);
        } else {
          appendResults();
        }
      } else {
        // Якщо нічого не знайдено за поточним запитом, пробуємо наступний
        if (i + 1 < queries.length) {
          nextQuery(queries, i + 1);
        } else {
          component.emptyForQuery(select_title);
        }
      }
    }

    function nextQuery(queries, i) {
      var clean_query = (queries[i] || '').replace(/[\:\-\!\?]/g, ' ').trim();
      var search_url = Utils.host() + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(clean_query);
      network.clear();
      network.timeout(15000);
      network[Utils.netMethod()](Utils.proxyUrl(search_url), function (html) {
        parseSearch(html, queries, i);
      }, function () {
        if (i + 1 < queries.length) {
          nextQuery(queries, i + 1);
        } else {
          component.emptyForQuery(select_title);
        }
      }, false, { dataType: 'text' });
    }

    function loadMedia(url) {
      component.activity.loader(true);
      var full_url = url.indexOf('http') === 0 ? url : Utils.host() + url;
      network.clear();
      network.timeout(15000);
      network[Utils.netMethod()](Utils.proxyUrl(full_url), function (html) {
        parsePage(html);
      }, component.empty.bind(component), false, { dataType: 'text' });
    }

    function parsePage(html) {
      var dom = $(html);
      var iframe = dom.find('iframe.player-container, iframe[src*="cinemar"], iframe[data-src*="cinemar"], iframe[src*="cinemap"]').first();
      var iframe_src = iframe.attr('src') || iframe.attr('data-src');

      if (!iframe_src) {
        var match = html.match(/(https?:\/\/[^"']*(?:cinemar|cinemap)[^"']*)/i);
        if (match) iframe_src = match[1];
      }

      if (iframe_src) {
        if (iframe_src.indexOf('http') !== 0) {
          iframe_src = (iframe_src.indexOf('//') === 0 ? 'https:' : Utils.host()) + iframe_src;
        }
        loadCinemarStream(iframe_src);
      } else {
        component.emptyForQuery(select_title);
      }
    }

    function loadCinemarStream(iframe_url) {
      network.clear();
      network.timeout(15000);
      network[Utils.netMethod()](Utils.proxyUrl(iframe_url), function (str) {
        var m3u8_match = str.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
        var file_match = str.match(/file\s*:\s*["']([^"']+)["']/i);
        var stream_url = '';

        if (m3u8_match) {
          stream_url = m3u8_match[1];
        } else if (file_match) {
          stream_url = file_match[1];
        }

        if (stream_url) {
          var episodes = [{
            title: object.movie.title,
            file: stream_url,
            quality: 'Auto HLS',
            season: 1,
            episode: 1
          }];
          component.loading(false);
          append(episodes);
        } else {
          component.emptyForQuery(select_title);
        }
      }, function () {
        component.emptyForQuery(select_title);
      }, false, { dataType: 'text' });
    }

    this.destroy = function () {
      network.clear();
      results = null;
    };

    this.reset = function () {
      component.reset();
      if (results.length) appendResults();
    };

    this.filter = function (type, a, b) {
      if (a.stype === 'release') {
        component.reset();
        loadMedia(results[b.index].url);
      }
    };

    function appendResults() {
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
          if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
          if (!element.file) return Lampa.Noty.show(Lampa.Lang.translate('uakinogo_nolink'));

          var first = {
            url: element.file,
            title: element.title,
            quality: { 'Auto': element.file }
          };

          if (options && options.runas) Lampa.Player.runas(options.runas);
          Lampa.Player.play(first);

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
      filter.onSelect = function (type, a, b) {
        if (type == 'filter') {
          if (a.reset) source.reset(); else source.filter(type, a, b);
        }
        setTimeout(_this.closeFilter, 10);
      };

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
      this.empty(Lampa.Lang.translate('uakinogo_results') + ' (' + query + ') нічого не знайдено');
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
      network.clear();
      files.destroy();
      scroll.destroy();
      source.destroy();
    };
  }

  uakinogo_source.initSettings = function () {
    var name = 'Uakinogo';
    if (Lampa.SettingsApi.getComponent(COMP)) return;

    Lampa.SettingsApi.addComponent({
      component: COMP,
      icon: '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/><text x="40" y="75" fill="white" font-size="40">UA</text></svg>',
      name: name + ' - ' + VERSION
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: {
        name: 'uakinogo_host',
        type: 'input',
        values: '',
        'default': 'https://uakinogo.io'
      },
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
  };

  function loadOnline(object) {
    if (online_loading) return;
    online_loading = true;
    resetTemplates();
    Lampa.Component.add(COMP, component);
    online_loading = false;
    Lampa.Activity.push({
      url: '',
      title: Lampa.Lang.translate('uakinogo_title'),
      component: COMP,
      search: object.title,
      search_one: object.title,
      search_two: object.original_title,
      movie: object,
      page: 1
    });
  }

  function initMain() {
    Lampa.Component.add(COMP, component);
    resetTemplates();

    var manifest = {
      type: 'video',
      version: VERSION,
      name: Lampa.Lang.translate('uakinogo_title') + ' - ' + VERSION,
      description: Lampa.Lang.translate('uakinogo_watch'),
