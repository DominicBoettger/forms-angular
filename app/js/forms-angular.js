'use strict';

var fng = angular.module( 'formsAngular'
    ,
    [   'ngRoute'
    ,   'ngSanitize'
    ,   'ui.select2'
    ,   'ui.date'
    ,   'ui.bootstrap'
    ,   'ngGrid'
    ,   'infinite-scroll'
    ,   'monospaced.elastic'
    ,   'ngCkeditor'
    ,   'guidelight.telepathic'
    ,   'uploadModule'
]);

fng.config(['teleProvider', function (teleProvider) {
    teleProvider.html5Mode(false);
    teleProvider.hashPrefix('!');
    teleProvider.serverBase('/api/');
}]);

fng.run(['tele', function (tele) {

    tele.routes( 'form', 'fng/', [
        { path: '/report/:modelName/:reportSchemaName',  route: { templateUrl: 'partials/base-report.html'   }},
        { path: '/report/:modelName',                    route: { templateUrl: 'partials/base-report.html'   }},
        { path: '/:modelName/:id/edit',                  route: { templateUrl: 'partials/base-edit.html'       }},
        { path: '/:modelName/new',                       route: { templateUrl: 'partials/base-edit.html'       }},
        { path: '/:modelName',                           route: { templateUrl: 'partials/base-list.html'       }},
        { path: '/:modelName/:formName/:id/edit',        route: { templateUrl: 'partials/base-edit.html'       }},
        { path: '/:modelName/:formName/new',             route: { templateUrl: 'partials/base-edit.html'       }},
        { path: '/:modelName/:formName',                 route: { templateUrl: 'partials/base-list.html'       }},
        { path: '/schema/:schemaName',                   route: { templateUrl: 'partials/schemaView.html'      }},
    ]);

    tele.routes( 'error', 'oops/', [
        { path: '/404',   route: { templateUrl: 'partials/404.html' }},
    ]);
}]);
