(function () {
    'use strict';

    function Uakinogo(component, _object) {
        var network = new Lampa.Reguest();
        var extract = [];
        var object = _object;
        var select_title = '';
        var filter_items = [];
        var choice = {
            season: 0,
            voice: 0
        };

        this.search = function (_object, kinopoisk_id) {
            object = _object;
            select_title = object.search || object.movie.title;
            
            var clean_title = select_title.replace(/[\:\-\!\?]/g, ' ').trim();
            var search_url = Lampa.Utils.proxy('https://uakinogo.io/index.php?do=search&subaction=search&story=' + encodeURIComponent(clean_title));

            network.clear();
            network.timeout(10000);
            network.native(search_url, function (str) {
                parseSearch(str);
            }, function (a, c) {
                component.emptyForQuery(select_title);
            }, false, { dataType: 'text' });
        };

        function parseSearch(html) {
            var dom = $(html);
            var results = dom.find('.movie-item, .shortstory, article'); 
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
                parseMedia(html);
            }, function () {
                component.emptyForQuery(select_title);
            }, false, { dataType: 'text' });
        }

        function parseMedia(html) {
            var dom = $(html);
            var iframe = dom.find('iframe[src*="cinemar"], iframe[src*="voidboost"], iframe[src*="collaps"], iframe[src*="player"]').first();
            var iframe_src = iframe.attr('src');

            if (!iframe_src) {
                // Спроба знайти посилання на плеєр в скриптах сторінки
                var match = html.match(/src=["'](https?: \/\/[^"']*(?:cinemar|player|video|iframe)[^"']*)["']/i);
                if (match) iframe_src = match[1];
            }

            if (iframe_src) {
                if (iframe_src.indexOf('http') !== 0) {
                    iframe_src = (iframe_src.indexOf('//') === 0 ? 'https:' : 'https://uakinogo.io') + iframe_src;
                }
                loadIframeStream(iframe_src);
            } else {
                component.emptyForQuery(select_title);
            }
        }

        function loadIframeStream(src) {
            src = Lampa.Utils.proxy(src);
            network.clear();
            network.timeout(10000);
            network.native(src, function (str) {
                var file_match = str.match(/file\s*:\s*["']([^"']+)["']/i) || str.match(/src\s*:\s*["']([^"']+)["']/i);
                
                if (file_match) {
                    var stream_url = file_match[1];
                    extract = [{
                        title: object.movie.title,
                        file: stream_url,
                        quality: '1080p'
                    }];
                    append(extract);
                } else {
                    // Якщо джерело плейлиста передається через конфіг Playerjs чи HLS
                    var m3u8_match = str.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
                    if (m3u8_match) {
                        extract = [{
                            title: object.movie.title,
                            file: m3u8_match[1],
                            quality: 'Auto'
                        }];
                        append(extract);
                    } else {
                        component.emptyForQuery(select_title);
                    }
                }
            }, function () {
                component.emptyForQuery(select_title);
            }, false, { dataType: 'text' });
        }

        function append(items) {
            component.reset();
            var list = [];

            items.forEach(function (element) {
                var item = Lampa.Template.get('online_mod_stream', element);
                item.on('hover:enter', function () {
                    var playlist = [];
                    items.forEach(function (elem) {
                        playlist.push({
                            title: elem.title,
                            url: elem.file,
                            quality: elem.quality
                        });
                    });

                    Lampa.Player.play({
                        title: object.movie.title,
                        url: element.file,
                        timeline: element.timeline,
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

    // Реєстрація джерела Uakinogo в Lampa Component
    function startPlugin() {
        window.uakinogo_plugin = true;
        
        // Реєстрація балансера в списку онлайн джерел
        if (window.Lampa && Lampa.Component) {
            Lampa.Component.add('uakinogo', Uakinogo);
        }

        // Додавання у налаштування Lampa
        Lampa.SettingsApi.addParam({
            component: 'online',
            param: {
                name: 'uakinogo_enabled',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Uakinogo.io',
                description: 'Показ відео з сайту uakinogo.io'
            }
        });
    }

    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') startPlugin();
        });
    }
})();
