(function () {
    'use strict';

    function Uakinogo(component, _object) {
        var network = new Lampa.Reguest();
        var object = _object;
        var select_title = '';

        this.search = function (_object, kinopoisk_id) {
            object = _object;
            select_title = object.search || object.movie.title;
            
            var clean_title = select_title.replace(/[\:\-\!\?]/g, ' ').trim();
            var search_url = Lampa.Utils.proxy('https://uakinogo.io/index.php?do=search&subaction=search&story=' + encodeURIComponent(clean_title));

            network.clear();
            network.timeout(10000);
            network.native(search_url, function (html) {
                parseSearch(html);
            }, function () {
                component.emptyForQuery(select_title);
            }, false, { dataType: 'text' });
        };

        function parseSearch(html) {
            var dom = $(html);
            var results = dom.find('.movie-item, .shortstory, article, .item'); 
            var found_url = '';

            results.each(function () {
                var title = $(this).find('.movie-title, .title, h2, a').text().toLowerCase();
                var href = $(this).find('a').attr('href');
                var orig_title = (object.movie.original_title || '').toLowerCase();
                var search_t = select_title.toLowerCase();

                if (href && (title.indexOf(search_t) >= 0 || (orig_title && title.indexOf(orig_title) >= 0))) {
                    found_url = href;
                    return false;
                }
            });

            if (!found_url && results.length > 0) {
                found_url = results.first().find('a').attr('href');
            }

            if (found_url) {
                getPage(found_url);
            } else {
                component.emptyForQuery(select_title);
            }
        }

        function getPage(url) {
            url = Lampa.Utils.proxy(url);
            network.clear();
            network.timeout(10000);
            network.native(url, function (html) {
                parseIframe(html);
            }, function () {
                component.emptyForQuery(select_title);
            }, false, { dataType: 'text' });
        }

        function parseIframe(html) {
            var dom = $(html);
            var iframe = dom.find('iframe.player-container, iframe[src*="cinemar"], iframe[data-src*="cinemar"]').first();
            var iframe_src = iframe.attr('src') || iframe.attr('data-src');

            if (!iframe_src) {
                var match = html.match(/(https?:\/\/[^"']*(?:cinemar|cinemap)[^"']*)/i);
                if (match) iframe_src = match[1];
            }

            if (iframe_src) {
                if (iframe_src.indexOf('http') !== 0) {
                    iframe_src = (iframe_src.indexOf('//') === 0 ? 'https:' : 'https://uakinogo.io') + iframe_src;
                }
                loadCinemarStream(iframe_src);
            } else {
                component.emptyForQuery(select_title);
            }
        }

        function loadCinemarStream(iframe_url) {
            var proxied_url = Lampa.Utils.proxy(iframe_url);

            network.clear();
            network.timeout(10000);
            network.native(proxied_url, function (str) {
                var m3u8_match = str.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);

                if (m3u8_match) {
                    var stream_url = m3u8_match[1];
                    buildPlaylist([{
                        title: object.movie.title,
                        file: stream_url,
                        quality: 'Auto HLS'
                    }]);
                } else {
                    var file_match = str.match(/file\s*:\s*["']([^"']+)["']/i);
                    if (file_match) {
                        buildPlaylist([{
                            title: object.movie.title,
                            file: file_match[1],
                            quality: 'Auto'
                        }]);
                    } else {
                        component.emptyForQuery(select_title);
                    }
                }
            }, function () {
                component.emptyForQuery(select_title);
            }, false, { dataType: 'text' });
        }

        function buildPlaylist(items) {
            component.reset();
            var list = [];

            items.forEach(function (element) {
                var item = Lampa.Template.get('online_mod_stream', element);
                
                item.on('hover:enter', function () {
                    var playlist = items.map(function (elem) {
                        return {
                            title: elem.title,
                            url: elem.file,
                            quality: elem.quality
                        };
                    });

                    Lampa.Player.play({
                        title: object.movie.title,
                        url: element.file,
                        playlist: playlist
                    });
                });

                list.push(item);
            });

            component.append(list);
        }

        this.reset = function () {
            component.reset();
        };

        this.destroy = function () {
            network.clear();
        };
    }

    function initPlugin() {
        if (window.uakinogo_plugin_loaded) return;
        window.uakinogo_plugin_loaded = true;

        // Реєстрація компонента в Lampa
        if (window.Lampa && Lampa.Component) {
            Lampa.Component.add('uakinogo', Uakinogo);
        }

        // Реєстрація в онлайн-модулі, щоб він з'явився у виборі балансерів
        if (window.Lampa && Lampa.Manifest) {
            Lampa.Manifest.plugins = Lampa.Manifest.plugins || [];
        }

        // Додавання налаштування та активації джерела
        if (window.Lampa && Lampa.SettingsApi) {
            Lampa.SettingsApi.addParam({
                component: 'online',
                param: {
                    name: 'uakinogo_enabled',
                    type: 'trigger',
                    default: true
                },
                field: {
                    name: 'Uakinogo.io',
                    description: 'Перегляд через Uakinogo (Cinemar)'
                }
            });
        }
    }

    if (window.appready) {
        initPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') initPlugin();
        });
    }
})();
