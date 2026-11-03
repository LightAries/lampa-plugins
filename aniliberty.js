// AniLiberty online — плагін для Lampa
// Структура повторює online_mod.js: initMain (кнопка + manifest) -> component -> модуль-джерело -> Player
(function () {
  'use strict';

  var VERSION = '03.11.2026';
  var COMP = 'aniliberty';
  var online_loading = false;

  /* ------------------------------------------------------------------ */
  /*  Utils                                                              */
  /* ------------------------------------------------------------------ */
  var Utils = {
    host: function () {
      return Lampa.Storage.get('aniliberty_host', 'https://aniliberty.top') + '';
    },
    api: function (path) {
      return this.host() + '/api/v1' + path;
    },
    // CORS-проксі (необов'язково). Формат: префікс + повний URL
    proxy: function () {
      if (Lampa.Storage.field('aniliberty_proxy') !== true) return '';
      return (Lampa.Storage.get('aniliberty_proxy_url', '') + '').trim();
    },
    proxyUrl: function (url) {
      var p = this.proxy();
      return p ? p + url : url;
    },
    // як у зразку: на Android native (без CORS), інакше silent
    netMethod: function () {
      return Lampa.Platform.is('android') ? 'native' : 'silent';
    },
    year: function (movie) {
      return ((movie.release_date || movie.first_air_date || '') + '').slice(0, 4);
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

  /* ------------------------------------------------------------------ */
  /*  Джерело: AniLiberty API v1                                         */
  /*  Інтерфейс як у модулів online_mod: search / filter / reset /       */
  /*  destroy + parse / filtred / append                                 */
  /* ------------------------------------------------------------------ */
  function aniliberty(component, _object) {
    var network = new Lampa.Reguest();
    var object = _object;
    var select_title = '';
    var results = [];      // результати пошуку (релізи)
    var release = null;    // відкритий реліз
    var episodes = [];     // епізоди релізу
    var qualities = [];    // доступні якості у релізі
    var forced_quality = '';
    var desc = false;      // порядок серій: false = від першої, true = від останньої
    var choices = Lampa.Storage.cache('aniliberty_choice', 200, {});
    var choice = choices[_object.movie.id] || {};
    forced_quality = choice.quality || '';
    desc = !!choice.desc;

    function saveChoice() {
      choice = {
        quality: forced_quality,
        desc: desc,
        release: release && release.id || choice.release
      };
      choices[object.movie.id] = choice;
      Lampa.Storage.set('aniliberty_choice', choices);
    }

    function relTitle(r) {
      var nm = r.name || {};
      return (nm.main || nm.english || r.alias) + (r.year ? ' (' + r.year + ')' : '');
    }

    function get(path, oncomplite, onerror) {
      network.clear();
      network.timeout(15000);
      network[Utils.netMethod()](Utils.proxyUrl(Utils.api(path)), function (json) {
        oncomplite(json);
      }, function (a, c) {
        if (onerror) onerror(network.errorDecode(a, c));
      });
    }

    /**
     * Пошук: пробуємо назви по черзі (укр/рос -> оригінал)
     */
    this.search = function (_object) {
      object = _object;
      select_title = object.search || object.movie.title;
      var error = component.empty.bind(component);

      var queries = object.clarification ? [object.search] : Utils.unique([
        object.search, object.search_one, object.search_two,
        object.movie.title, object.movie.original_title, object.movie.original_name
      ]);

      function next(i) {
        if (i >= queries.length) return component.emptyForQuery(select_title);
        get('/app/search/releases?query=' + encodeURIComponent(queries[i]), function (json) {
          var list = Array.isArray(json) ? json : (json && (json.data || json.releases)) || [];
          if (list.length) parseList(list);else next(i + 1);
        }, error);
      }

      next(0);
    };

    function parseList(list) {
      results = list;
      var saved = list.filter(function (r) {
        return r.id == choice.release;
      })[0];
      if (list.length === 1) loadRelease(list[0].id);else if (saved && !object.clarification) loadRelease(saved.id);else {
        component.loading(false);
        appendResults();
      }
    }

    /**
     * Завантажити реліз з епізодами
     */
    function loadRelease(id) {
      component.activity.loader(true);
      get('/anime/releases/' + encodeURIComponent(id), function (json) {
        parseRelease(json);
      }, component.empty.bind(component));
    }

    function parseRelease(json) {
      release = json;
      saveChoice();
      episodes = (json && json.episodes || []).slice().sort(function (a, b) {
        return (a.sort_order || a.ordinal || 0) - (b.sort_order || b.ordinal || 0);
      });
      if (!episodes.length) return component.emptyForQuery(select_title);

      qualities = ['1080p', '720p', '480p'].filter(function (q) {
        return episodes.some(function (e) {
          return e['hls_' + q.replace('p', '')];
        });
      });

      component.loading(false);
      filter();
      append(filtred());
    }

    this.destroy = function () {
      network.clear();
      results = null;
      release = null;
      episodes = null;
    };

    this.reset = function () {
      forced_quality = '';
      desc = false;
      saveChoice();
      component.reset();
      if (release) {
        filter();
        append(filtred());
      }
    };

    this.filter = function (type, a, b) {
      if (a.stype === 'quality') forced_quality = b.title;else if (a.stype === 'order') desc = b.index === 1;else if (a.stype === 'release') {
        component.reset();
        return loadRelease(results[b.index].id);
      }
      saveChoice();
      component.reset();
      filter();
      append(filtred());
    };

    /* -------------------------- якість ------------------------------ */
    function wantedQuality() {
      var q = forced_quality || Lampa.Storage.get('aniliberty_quality', '1080p');
      if (qualities.indexOf(q) === -1) q = qualities[0];
      return q;
    }

    function pickUrl(e, q) {
      var order = ['1080p', '720p', '480p'];
      var start = order.indexOf(q);
      for (var i = start; i < order.length; i++) {
        var u = e['hls_' + order[i].replace('p', '')];
        if (u) return u;
      }
      for (var j = start - 1; j >= 0; j--) {
        var u2 = e['hls_' + order[j].replace('p', '')];
        if (u2) return u2;
      }
      return '';
    }

    function filter() {
      var idx = 0;
      (results || []).forEach(function (r, i) {
        if (release && r.id == release.id) idx = i;
      });
      component.filter({
        quality: qualities,
        releases: results && results.length > 1 ? results.map(relTitle) : []
      }, {
        quality: wantedQuality(),
        desc: desc,
        release_index: idx
      });
    }

    /**
     * Перетворити епізоди в елементи списку
     */
    function filtred() {
      var q = wantedQuality();
      var list = desc ? episodes.slice().reverse() : episodes;
      return list.map(function (e) {
        var quality = {};
        ['1080', '720', '480'].forEach(function (n) {
          if (e['hls_' + n]) quality[n + 'p'] = e['hls_' + n];
        });
        var nm = e.name && (e.name + '').trim();
        return {
          title: Lampa.Lang.translate('aniliberty_episode') + ' ' + e.ordinal + (nm ? ' / ' + nm : ''),
          quality: q,
          info: e.duration ? ' / ' + Math.round(e.duration / 60) + ' ' + Lampa.Lang.translate('aniliberty_min') : '',
          season: 1,
          episode: e.ordinal,
          file: pickUrl(e, q),
          qualities: quality,
          opening: e.opening,
          ending: e.ending
        };
      });
    }

    /* ------------------------ відображення -------------------------- */
    function appendResults() {
      component.reset();
      results.forEach(function (r) {
        var nm = r.name || {};
        var info = [r.year, r.type && r.type.description, r.episodes_total ? r.episodes_total + ' ' + Lampa.Lang.translate('aniliberty_ep_short') : '']
          .filter(Boolean).join(' / ');
        var item = Lampa.Template.get('aniliberty_folder', {
          title: nm.main || nm.english || r.alias,
          quality: '',
          info: info
        });
        item.on('hover:enter', function () {
          component.reset();
          loadRelease(r.id);
        });
        component.append(item);
      });
      component.start(true);
    }

    function append(items) {
      component.reset();
      var viewed = Lampa.Storage.cache('online_view', 5000, []);

      // повернення до списку результатів, якщо їх було кілька
      if (results && results.length > 1) {
        var back = Lampa.Template.get('aniliberty_folder', {
          title: '← ' + Lampa.Lang.translate('aniliberty_results'),
          quality: '',
          info: ''
        });
        back.on('hover:enter', function () {
          release = null;
          appendResults();
        });
        component.append(back);
      }

      var rid = release && release.id || '';

      items.forEach(function (element) {
        var hash = Lampa.Utils.hash([element.season, element.episode, rid, object.movie.original_title].join(''));
        var view = Lampa.Timeline.view(hash);
        var item = Lampa.Template.get('aniliberty', element);
        var hash_file = Lampa.Utils.hash([element.season, element.episode, rid, element.title].join(''));

        element.timeline = view;
        item.append(Lampa.Timeline.render(view));
        if (Lampa.Timeline.details) item.find('.online__quality').append(Lampa.Timeline.details(view, ' / '));

        if (viewed.indexOf(hash_file) !== -1) {
          item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
        }

        item.on('hover:enter', function (event, options) {
          if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
          if (!element.file) return Lampa.Noty.show(Lampa.Lang.translate('aniliberty_nolink'));

          function make(el) {
            return {
              url: el.file,
              quality: el.qualities,
              timeline: el.timeline,
              title: el.title
            };
          }

          var first = make(element);
          var playlist = items.map(make);
          if (playlist.length > 1) first.playlist = playlist;

          if (options && options.runas) Lampa.Player.runas(options.runas);
          Lampa.Player.play(first);
          Lampa.Player.playlist(playlist);

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

  aniliberty.initSettings = function () {
    var name = 'AniLiberty';
    if (Lampa.SettingsApi.getComponent(COMP)) return;

    Lampa.SettingsApi.addComponent({
      component: COMP,
      icon: '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/><path d="M90.5 64.3827L50 87.7654L50 41L90.5 64.3827Z" fill="white"/></svg>',
      name: name + ' - ' + VERSION
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: {
        name: 'aniliberty_host',
        type: 'select',
        values: {
          'https://aniliberty.top': 'aniliberty.top',
          'https://anilibria.top': 'anilibria.top'
        },
        'default': 'https://aniliberty.top'
      },
      field: { name: Lampa.Lang.translate('aniliberty_host') }
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: {
        name: 'aniliberty_quality',
        type: 'select',
        values: { '1080p': '1080p', '720p': '720p', '480p': '480p' },
        'default': '1080p'
      },
      field: { name: Lampa.Lang.translate('settings_player_quality') }
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: { name: 'aniliberty_proxy', type: 'trigger', 'default': false },
      field: { name: Lampa.Lang.translate('aniliberty_proxy') }
    });

    Lampa.SettingsApi.addParam({
      component: COMP,
      param: { name: 'aniliberty_proxy_url', type: 'input', values: '', 'default': '' },
      field: {
        name: Lampa.Lang.translate('aniliberty_proxy_url'),
        description: Lampa.Lang.translate('aniliberty_proxy_url_descr')
      }
    });
  };

  /* ------------------------------------------------------------------ */
  /*  Головний компонент (скрол, фільтр, навігація)                      */
  /* ------------------------------------------------------------------ */
  function component(object) {
    var network = new Lampa.Reguest();
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var source = new aniliberty(this, object);
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
          if (a.reset) source.reset();else source.filter(type, a, b);
        }
        setTimeout(_this.closeFilter, 10);
      };

      filter.render().find('.filter--sort').remove();
      files.appendHead(filter.render());
      files.appendFiles(scroll.render());

      source.search(object);
      return this.render();
    };

    /**
     * Меню фільтра: реліз (сезон), якість, порядок серій + скидання
     */
    this.filter = function (items, current) {
      var select = [];
      var chosen = [];

      function add(stype, title, values, index) {
        select.push({
          title: title,
          subtitle: values[index],
          stype: stype,
          items: values.map(function (v, i) {
            return { title: v, selected: i === index, index: i };
          })
        });
        chosen.push(title + ': ' + values[index]);
      }

      if (items.releases.length) add('release', Lampa.Lang.translate('aniliberty_release'), items.releases, current.release_index);
      add('quality', Lampa.Lang.translate('settings_player_quality'), items.quality, Math.max(0, items.quality.indexOf(current.quality)));
      add('order', Lampa.Lang.translate('aniliberty_order'), [
        Lampa.Lang.translate('aniliberty_order_asc'),
        Lampa.Lang.translate('aniliberty_order_desc')
      ], current.desc ? 1 : 0);

      select.push({ title: Lampa.Lang.translate('torrent_parser_reset'), reset: true });
      filter.set('filter', select);
      filter.chosen('filter', chosen);
    };

    this.closeFilter = function () {
      if ($('body').hasClass('selectbox--open')) Lampa.Select.close();
    };

    this.reset = function () {
      last = false;
      scroll.clear();
    };

    this.loading = function (status) {
      if (status) this.activity.loader(true);else {
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
      this.empty(Lampa.Lang.translate('aniliberty_query_start') + ' (' + query + ') ' + Lampa.Lang.translate('aniliberty_query_end'));
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
          if (Navigator.canmove('up')) Navigator.move('up');else Lampa.Controller.toggle('head');
        },
        down: function down() {
          Navigator.move('down');
        },
        right: function right() {
          if (Navigator.canmove('right')) Navigator.move('right');else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
        },
        left: function left() {
          if (Navigator.canmove('left')) Navigator.move('left');else Lampa.Controller.toggle('menu');
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
      network = null;
      source.destroy();
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Шаблони, мова, кнопка                                              */
  /* ------------------------------------------------------------------ */
  function resetTemplates() {
    Lampa.Template.add('aniliberty',
      '<div class="online selector"><div class="online__body">' +
      '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em">' +
      '<svg style="height:2.4em;width:2.4em;" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/>' +
      '<path d="M90.5 64.3827L50 87.7654L50 41L90.5 64.3827Z" fill="white"/></svg></div>' +
      '<div class="online__title" style="padding-left:2.1em;">{title}</div>' +
      '<div class="online__quality" style="padding-left:3.4em;">{quality}{info}</div>' +
      '</div></div>');

    Lampa.Template.add('aniliberty_folder',
      '<div class="online selector"><div class="online__body">' +
      '<div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em">' +
      '<svg style="height:2.4em;width:2.4em;" viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect y="20" width="128" height="92" rx="13" fill="white"/>' +
      '<path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"/>' +
      '<rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"/></svg></div>' +
      '<div class="online__title" style="padding-left:2.1em;">{title}</div>' +
      '<div class="online__quality" style="padding-left:3.4em;">{quality}{info}</div>' +
      '</div></div>');
  }

  function initLang() {
    Lampa.Lang.add({
      aniliberty_title: { ru: 'AniLiberty', uk: 'AniLiberty', en: 'AniLiberty' },
      aniliberty_watch: { ru: 'Смотреть онлайн', uk: 'Дивитись онлайн', en: 'Watch online' },
      aniliberty_episode: { ru: 'Серия', uk: 'Серія', en: 'Episode' },
      aniliberty_min: { ru: 'мин', uk: 'хв', en: 'min' },
      aniliberty_ep_short: { ru: 'эп.', uk: 'еп.', en: 'ep.' },
      aniliberty_results: { ru: 'Результаты поиска', uk: 'Результати пошуку', en: 'Search results' },
      aniliberty_nolink: { ru: 'Не удалось извлечь ссылку', uk: 'Не вдалося отримати посилання', en: 'Failed to get the link' },
      aniliberty_query_start: { ru: 'По запросу', uk: 'За запитом', en: 'No results for' },
      aniliberty_query_end: { ru: 'ничего не найдено', uk: 'нічого не знайдено', en: 'found' },
      aniliberty_release: { ru: 'Релиз / сезон', uk: 'Реліз / сезон', en: 'Release / season' },
      aniliberty_order: { ru: 'Порядок серий', uk: 'Порядок серій', en: 'Episode order' },
      aniliberty_order_asc: { ru: 'С первой', uk: 'З першої', en: 'First to last' },
      aniliberty_order_desc: { ru: 'С последней', uk: 'З останньої', en: 'Last to first' },
      aniliberty_host: { ru: 'Адрес API', uk: 'Адреса API', en: 'API host' },
      aniliberty_proxy: { ru: 'Использовать CORS-прокси', uk: 'Використовувати CORS-проксі', en: 'Use CORS proxy' },
      aniliberty_proxy_url: { ru: 'URL прокси', uk: 'URL проксі', en: 'Proxy URL' },
      aniliberty_proxy_url_descr: {
        ru: 'Префикс, к которому добавляется полный URL запроса',
        uk: 'Префікс, до якого додається повний URL запиту',
        en: 'Prefix to which the full request URL is appended'
      }
    });
  }

  function loadOnline(object) {
    if (online_loading) return;
    online_loading = true;
    resetTemplates();
    Lampa.Component.add(COMP, component);
    online_loading = false;
    Lampa.Activity.push({
      url: '',
      title: Lampa.Lang.translate('aniliberty_title'),
      component: COMP,
      search: object.title,
      search_one: object.title,
      search_two: object.original_title,
      movie: object,
      page: 1
    });
  }

  function initMain() {
    // заглушка, щоб при старті Lampa не казала "пусто"
    Lampa.Component.add(COMP, component);
    resetTemplates();

    var manifest = {
      type: 'video',
      version: VERSION,
      name: Lampa.Lang.translate('aniliberty_title') + ' - ' + VERSION,
      description: Lampa.Lang.translate('aniliberty_watch'),
      component: COMP,
      onContextMenu: function onContextMenu() {
        return { name: Lampa.Lang.translate('aniliberty_watch'), description: '' };
      },
      onContextLauch: function onContextLauch(object) {
        online_loading = false;
        loadOnline(object);
      }
    };
    Lampa.Manifest.plugins = manifest;

    var button = '<div class="full-start__button selector view--aniliberty" data-subtitle="aniliberty ' + VERSION + '">' +
      '<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
      '<circle cx="64" cy="64" r="56" stroke="currentColor" stroke-width="12"/>' +
      '<path d="M90.5 64.3827L50 87.7654L50 41L90.5 64.3827Z" fill="currentColor"/></svg>' +
      '<span>AniLiberty</span></div>';

    Lampa.Listener.follow('full', function (e) {
      if (e.type == 'complite') {
        var render = e.object.activity.render();
        if (render.find('.view--aniliberty').length) return;
        var btn = $(button);
        online_loading = false;
        btn.on('hover:enter', function () {
          loadOnline(e.data.movie);
        });
        render.find('.view--torrent').after(btn);
      }
    });
  }

  function startPlugin() {
    if (window.plugin_aniliberty_ready) return;
    window.plugin_aniliberty_ready = true;
    initLang();
    initMain();
    aniliberty.initSettings();
  }

  if (window.appready) startPlugin();else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type == 'ready') startPlugin();
    });
  }
})();
