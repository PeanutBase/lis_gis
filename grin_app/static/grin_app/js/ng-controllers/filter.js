"use strict";
/*
 * filterController; search settings and user controls
 */

app.controller('filterController',
    function ($scope, $state, $http, $location, $uibModal, $localStorage,
              geoJsonService) {

       
        $scope.init = function () {
            var params = geoJsonService.params;
            $scope.model = {
                localStorage: $localStorage,
                geoJsonService: geoJsonService,
                countries: [],
                searchOptions: false,
                autofocusField: null,
                alert: null,
                $location: $location,
                limitToMapExtent: parseBool(params.limitToMapExtent),
                maxRecs: params.maxRecs,
                country: params.country,
                taxonQuery: params.taxonQuery,
                accessionIds: params.accessionIds,
                accessionIdsColor: params.accessionIdsColor,
                accessionIdsInclusive: parseBool(params.accessionIdsInclusive),
                traitOverlay: params.traitOverlay,
                traitScale: params.traitScale,
                traitExcludeUnchar: parseBool(params.traitExcludeUnchar)
            };
            // generate URL w/ cache bust
            var url = API_PATH + '/countries?v=' + new Date().getTime();
            $http.get(url).then(function (resp) {
                // success callback
                $scope.model.countries = resp.data;
            }, function (resp) {
                // error callback
                console.log(resp);
            });
            // fetch the list of traits for this taxon query
            if ($scope.model.taxonQuery) {
                $scope.onTaxonQuery($scope.model.taxonQuery);
            }
        };

        // some parameters may be updated by the userDataController,
        // so listen for changes on the geoJsonService
        geoJsonService.subscribe($scope, 'accessionIdsUpdated', function () {
            $scope.model.accessionIds = geoJsonService.params.accessionIds;
            refreshTraitMenu($scope.model.taxonQuery);
        });
        geoJsonService.subscribe($scope, 'taxonUpdated', function () {
            $scope.model.taxonQuery = geoJsonService.params.taxonQuery;;
            refreshTraitMenu($scope.model.taxonQuery);
        });
        geoJsonService.subscribe($scope, 'traitOverlayUpdated', function () {
            $scope.model.traitOverlay = geoJsonService.params.traitOverlay;
        });
        geoJsonService.subscribe($scope, 'updated', function () {
            $scope.model.accessionIds = geoJsonService.params.accessionIds;
        });

        $scope.onOK = function () {
            // user hit OK in the search parameters panel, or search is being
            // updated programmatically: update geojson service with all
            // search params, then do search.
            $scope.model.autofocusField = null;
            $scope.model.alert = null;
            $scope.model.searchOptions = false;
            geoJsonService.setGeocodedAccessionsOnly($scope.model.country !== null, false);
            geoJsonService.setMaxRecs($scope.model.maxRecs, false);
            geoJsonService.setLimitToMapExtent($scope.model.limitToMapExtent, false);
            geoJsonService.setTaxonQuery($scope.model.taxonQuery, false);
            geoJsonService.setCountry($scope.model.country, false);
            geoJsonService.setAccessionIds($scope.model.accessionIds, false);
            geoJsonService.setAccessionIdsColor($scope.model.accessionIdsColor, false);
            geoJsonService.setAccessionIdsInclusive($scope.model.accessionIdsInclusive, false);
            geoJsonService.setTraitOverlay($scope.model.traitOverlay, false);
            geoJsonService.setTraitScale($scope.model.traitScale, false);
            geoJsonService.setTraitExcludeUnchar($scope.model.traitExcludeUnchar, false);
            geoJsonService.search();
        };

        $scope.onRemoveMaxResults = function () {
            $scope.model.autofocusField = 'maxRecs';
            $scope.model.searchOptions = true;
            $scope.model.alert = 'Max results: You can set the limit of search results, ' +
                ' but cannot remove the limit.';
        };

        $scope.onCountry = function (country) {
            if (country) {
                $scope.model.limitToMapExtent = false;
                geoJsonService.setGeocodedAccessionsOnly(true, false);
                geoJsonService.setLimitToMapExtent(false, false);
            }
        };

        $scope.onTaxonQuery = function (taxon) {
            // taxon query field was typed or updated. filter the trait
            // descriptors to match
            if (!taxon || taxon.length < 3) {
                return;
            }
           refreshTraitMenu(taxon);
        };

        function refreshTraitMenu(taxon) {
            $scope.model.traitDescriptors = null;
            if(_.isEmpty(taxon)) { return; }
            var callback = function(data) {
                $scope.model.traitDescriptors = data;
                // reset the trait selection, if it's no longer valid for this
                // taxon query
                // if(! $scope.model.traitOverlay in data) {
                //     $scope.model.traitOverlay = null;
                // }
            };
            geoJsonService.getTraitDescriptors(taxon, callback);
        }

        $scope.onExampleAccessions = function () {
            $scope.model.limitToMapExtent = false;
            $scope.model.country = null;
            $scope.model.taxonQuery = null;
            $scope.model.accessionIds = null;
            $scope.model.traitOverlay = null;

            // generate url w/ cache bust
            var url = STATIC_PATH + '/grin_app/js/example-accession-ids.json?v=' + new Date().getTime();
            $http.get(url).then(function (resp) {
                // success callback
                var ids = resp.data;
                $scope.model.accessionIds = ids.join(',');
            }, function (resp) {
                // error callback
                console.log(resp);
            });

        };

        $scope.onTraitsRefresh = function() {
            refreshTraitMenu($scope.model.taxonQuery);
        };

        $scope.onTraitOverlayExample = function () {
            $scope.model.limitToMapExtent = false;
            $scope.model.country = null;
            $scope.model.accessionIds = null;
            $scope.model.traitOverlay = 'PODWEIGHT';
            $scope.model.taxonQuery = 'Arachis hypogaea';
            $scope.model.traitScale = 'local';
            $scope.onTaxonQuery($scope.model.taxonQuery);
        };

        $scope.onTraitOverlayOptions = function () {
            var modal = $uibModal.open({
                animation: true,
                templateUrl: STATIC_PATH +
                'grin_app/partials/trait-overlay-options-modal.html',
                controller: 'traitOverlayOptionsController',
                size: 'lg',
                resolve: {
                    model: function () {
                        return {
                            traitOverlay: $scope.model.traitOverlay,
                            traitScale: $scope.model.traitScale,
                            traitExcludeUnchar: $scope.model.traitExcludeUnchar
                        }
                    }
                }
            });
            modal.result.then(function (result) {
                if (!result) {
                    return;
                }
                /* cancelled */
                $scope.model.traitScale = result.traitScale;
                $scope.model.traitExcludeUnchar = result.traitExcludeUnchar;
            }, function () {
                // modal otherwise dismissed callback (ignore result) e.g. backdrop click
            });
        };

        // get a short label for displaying in the current-search-filters area
        $scope.accessionIdsDescr = function () {
            var idsStr = geoJsonService.params.accessionIds;
            if (!idsStr) {
                return null;
            }
            var ids = idsStr.split(',');
            if (ids.length > 5) {
                return '(' + ids.length + ' accession IDs)';
            }
            return idsStr;
        };

        $scope.onAccessionIdOptions = function () {
            var modal = $uibModal.open({
                animation: true,
                templateUrl: STATIC_PATH +
                'grin_app/partials/accession-search-options-modal.html',
                controller: 'accessionSearchOptionsController',
                size: 'lg',
                resolve: {
                    model: function () {
                        return {
                            accessionIds: $scope.model.accessionIds,
                            accessionIdsColor: $scope.model.accessionIdsColor,
                            accessionIdsInclusive: $scope.model.accessionIdsInclusive,
                            brewerColors: chroma.brewer.Set1.concat(
                                chroma.brewer.Set2,
                                chroma.brewer.Set3)
                        }
                    }
                }
            });
            modal.result.then(function (result) {
                if (!result) {
                    return; // cancelled
                }
                $scope.model.accessionIds = result.accessionIds;
                $scope.model.accessionIdsColor = result.accessionIdsColor;
                $scope.model.accessionIdsInclusive = result.accessionIdsInclusive;
            }, function () {
                // modal otherwise dismissed callback (ignore result)
                // e.g. backdrop click
            });
        };

        $scope.onExampleTaxonQuery = function () {
            $scope.model.taxonQuery = 'Arachis hypogaea';
            $scope.model.limitToMapExtent = false;
            $scope.model.country = null;
            $scope.model.accessionIds = null;
            $scope.model.traitOverlay = null;
            $scope.onTaxonQuery($scope.model.taxonQuery);
        };

        $scope.init();
    });
