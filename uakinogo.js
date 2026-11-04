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
            // Запит на пошук у DLE сторінці uakinogo.io
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
            // Шукаємо iframe з cinemar або плеєром
            var iframe = dom.find('iframe.player-container, iframe[src*="cinemar"], iframe[data-src*="cinemar"]').first();
            var iframe_src = iframe.attr('src') || iframe.attr('data-src');

            if (!iframe_src) {
                var match = html.match(/(https?: \/\/[^"']*(?:cinemar|cinemap)[^"']*)/i);
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
            // Проксуємо запит до iframe cinemar, щоб пройти CORS та отримати токени/код
            var proxied_url = Lampa.Utils.proxy(iframe_url);

            network.clear();
            network.timeout(10000);
            network.native(proxied_url, function (str) {
                // 1. Пошук прямого .m3u8 посилання всередині iframe/скриптів
                var m3u8_match = str.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);

                if (m3u8_match) {
                    var stream_url = m3u8_match[1];
                    buildPlaylist([{
                        title: object.movie.title,
                        file: stream_url,
                        quality: 'Auto HLS'
                    }]);
                } else {
                    // 2. Пошук файлу конфігу Playerjs або зашифрованого джерела
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
                        url: element.
