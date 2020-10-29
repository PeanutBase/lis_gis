'use strict';

/* instantiate ng-app 'grin' */

var app = angular.module('grin',
    ['ngSanitize',
        'ngStorage',
        'mp.autoFocus',
        'ui.bootstrap',
        'ui.router']);

app.config(function ($httpProvider, $stateProvider) {

    $stateProvider
        .state('search', {
            reloadOnSearch: true,
            views: {
                'errors': {
                    templateUrl: STATIC_PATH + 'grin_app/partials/errors.html',
                    controller: 'errorsController'
                },
                'filter': {
                    templateUrl: STATIC_PATH + 'grin_app/partials/search-filter.html',
                    controller: 'filterController'
                },
                'list': {
                    templateUrl: STATIC_PATH + 'grin_app/partials/search-list.html',
                    controller: 'listController'
                },
                'map': {
                    templateUrl: STATIC_PATH + 'grin_app/partials/search-map.html',
                    controller: 'mapController'
                }
            }
        });

    function httpErrorInterceptor($q, $rootScope) {

        $rootScope.errors = [];
        $rootScope.warnings = [];

        function requestError(rejection) {
            console.log('requestError:');
            console.log(rejection);
            return ($q.reject(rejection));  // pass-through the rejection.
        }

        function responseError(response) {
            var msg = null;
            console.log('responseError:');
            console.log(response);
            switch (response.status) {
                case 0:
                    msg = 'Lost connection to web app. Please check your ' +
                        'network connection, or try again later.';
                    break;
                case -1:
                    msg = 'Lost connection to web app. Please check your ' +
                        'network connection, or try again later.';
                    break;
                case 404:
                    // allow 404 not found, if the accession detail controller
                    // does an HTTP HEAD to check for validity of link-out.
                    if (response.config.url.indexOf('organism/') === -1) {
                        msg = response.status + ' ' +
                            response.statusText + ' ' +
                            response.config.url + ' ' +
                            response.data;
                    }
                    break;
                case 500:
                    msg = response.status + ' ' +
                        response.statusText + ' ' +
                        response.config.url + ' ' +
                        response.data;
                    break;
            }
            if (msg) {
                $rootScope.errors.push(msg);
                console.log($rootScope.errors);
            }
            return ($q.reject(response)); // pass-through the response
        }

        return ({
            requestError: requestError,
            responseError: responseError
        });
    }

    $httpProvider.interceptors.push(httpErrorInterceptor);
    $httpProvider.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
    $httpProvider.defaults.xsrfCookieName = 'csrftoken';
    $httpProvider.defaults.xsrfHeaderName = 'X-CSRFToken';

    // Prevent caching for all our Ajax API calls (GET and POST)
    if (!$httpProvider.defaults.headers.common) {
        $httpProvider.defaults.headers.common = {};    
    }
    $httpProvider.defaults.headers.common['Cache-Control'] = 'no-cache';
    $httpProvider.defaults.headers.common['Pragma'] = 'no-cache';
    // hack to disable IE ajax request caching
    $httpProvider.defaults.headers.common['If-Modified-Since'] = 'Mon, 26 Jul 1997 05:00:00 GMT';
});

app.filter('highlight', function ($sce) {
    return function (text, phrase) {
        var t = text;
        if (phrase) {
            t = t.replace(new RegExp('(' + phrase + ')', 'gi'),
                '<span class="hilite-text">$1</span>');
        }
        return $sce.trustAsHtml(t);
    }
});

app.filter('isEmpty', [function () {
    return function (object) {
        return angular.equals({}, object);
    }
}]);


function parseBool(val) {
    return val === true || val === "true";
}

function showTourOneTime() {
  var TOUR_ID = 'germplasm-map';
  var j = localStorage.getItem('lisTourVisited');
  if(!j || ! JSON.parse(j)[TOUR_ID]) {
    if(! lisTours.active()) {
      lisTours.go(TOUR_ID);
    }
  }
}

app.run(function ($state) {
  $state.transitionTo('search');
//showTourOneTime();
});
