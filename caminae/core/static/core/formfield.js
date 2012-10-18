if (! FormField); var FormField = {};

FormField.makeModule = function(module, module_settings) {
    module.enableDrawing = function(map, drawncallback, startovercallback) {
        var drawControl = new L.Control.Draw({
            position: 'topright',
            polygon: module_settings.enableDrawing.is_polygon,
            rectangle: false,
            circle: false,
            marker: module_settings.enableDrawing.is_marker,
            polyline: module_settings.enableDrawing.is_polyline && {
                shapeOptions: {
                    color: '#35FF00',
                    opacity: 0.8,
                    weight: 3
                }
            }
        });
        map.addControl(drawControl);
        map.drawControl = drawControl;

        // Delete current on first clic (start drawing)
        map.on('click', function (e) {
            // Delete current on clic if drawing
            for (var handlertype in map.drawControl.handlers) {
                if (map.drawControl.handlers[handlertype].enabled()) {
                    startovercallback();
                    return;
                }
            }
        });

        // Show control as enabled on activation
        for (var h in map.drawControl.handlers) {
            map.drawControl.handlers[h].on('activated', function () {
                $('.leaflet-control-draw-' + h).parent().addClass('enabled');
            });
        }

        // Listen to all events of creation, Leaflet.Draw naming inconsistency
        var draw_types = {
            'polyline': 'poly',
            'point': 'marker',
            'polygon': 'polygon',
        };
        for (var geomtype in draw_types) {
            var draw_type = draw_types[geomtype];
            map.on('draw:' + draw_type + '-created', L.Util.bind(function (e) {
                console.log('Drawn ' + this.type);
                var drawn = e[this.type];  // Leaflet.Draw naming inconsistency
                
                // Show control as disabled after creation
                for (var h in map.drawControl.handlers) {
                    $('.leaflet-control-draw-' + h).parent().removeClass('enabled');
                }
                drawncallback(drawn);
            }, {type: draw_type}));
        }
    };


    module.enablePathSnapping = function(map, modelname, objectsLayer) {
        var snapObserver = null;
        // Snapping is always on paths layer. But only if model is not path,
        // since snapping will then be on objects layer.
        // Allows to save loading twice the same layer.
        if (modelname != 'path') {
            var pathsLayer = new MapEntity.ObjectsLayer(null, {
                style: {weight: 2, clickable: true, color: module_settings.colors.paths},
            });
            map.addLayer(pathsLayer);
            snapObserver = new MapEntity.SnapObserver(map, pathsLayer);
            // Start ajax loading at last
            pathsLayer.load(module_settings.enablePathSnapping.pathsLayer_url);
        }
        else {
            snapObserver = new MapEntity.SnapObserver(map, objectsLayer);
        }
        return snapObserver;
    };


    // Returns the pk of the mapentity object if it exists
    // FIXME: $('form') => fails if there are more than one form
    module.getObjectPk = function() {
        // On creation, this should be null
        return $('form input[name="pk"]').val() || null;
    };

    module.addObjectsLayer = function(map, modelname) {
        if (!modelname) {
            throw 'Model name is empty';
        }
        var object_pk = module.getObjectPk();

        var exclude_current_object = null;
        if (object_pk) {
            exclude_current_object = function (geojson) {
                if (geojson.properties && geojson.properties.pk)
                    return geojson.properties.pk != object_pk;
            }
        }

        // Start loading all objects, readonly
        var color = modelname == 'path' ? module_settings.colors.paths : module_settings.colors.others;
        var objectsLayer = new MapEntity.ObjectsLayer(null, {
            style: {weight: 2, clickable: true, 'color': color},
                filter: exclude_current_object
            }),
            url = module_settings.addObjectsLayer.getUrl(modelname);
        map.addLayer(objectsLayer);
        objectsLayer.load(url);
        return objectsLayer;
    };

    module.enableMultipath = function(map, objectsLayer, layerStore, onStartOver, snapObserver) {
        objectsLayer.on('load', function() {

            var parseGraph = function (graph) {

                var multipath_control = new L.Control.Multipath(map, objectsLayer, graph, snapObserver, {
                        handler: {
                            'iconUrl': module_settings.init.iconUrl,
                            'shadowUrl': module_settings.init.shadowUrl,
                            'iconDragUrl': module_settings.init.iconDragUrl,
                        }
                    })
                  , multipath_handler = multipath_control.multipath_handler
                ;

                onStartOver.on('startover', function(obj) {
                    // If startover is not trigger by multipath, delete the geom
                    // Thus, when multipath is called several times, the geom is not deleted
                    // and may be updated
                    if (obj.handler !== 'multipath') {
                        multipath_handler.showPathGeom(null);
                    }
                    if (obj.handler == 'topologypoint') {
                        // Disable multipath
                        multipath_handler.reset();
                        if (multipath_handler.enabled()) multipath_control.toggle();
                    }
                });
                // Delete previous geom
                multipath_handler.on('enabled', function() {
                    onStartOver.fire('startover', {'handler': 'multipath'});
                });

                multipath_handler.on('computed_topology', function (e) {
                    layerStore.storeLayerGeomInField(e.topology);
                });
                
                map.addControl(multipath_control);

                var initialTopology = layerStore.getSerialized();

                // We should check if the form has an error or not...
                // core.models#TopologyMixin.serialize
                if (initialTopology) {
                    var topo =  JSON.parse(initialTopology);
                    // If it is multipath, restore
                    if (topo.paths && !topo.lat && !topo.lng) {
                        multipath_handler.restoreTopology(topo);
                    }
                }
            };
            
            $.getJSON(module_settings.enableMultipath.path_json_graph_url, parseGraph).error(function (jqXHR, textStatus, errorThrown) {
                $(map._container).addClass('map-error');
                console.error("Could not load url '" + module_settings.enableMultipath.path_json_graph_url + "': " + textStatus);
                console.error(errorThrown);
            });
        });
    };

    module.enableTopologyPoint = function (map, drawncallback, onStartOver) {
        var control = new L.Control.TopologyPoint(map)
          , handler = control.topologyhandler;
        map.addControl(control);
        
        // Delete current on first clic (start drawing)
        handler.on('enabled', function (e) {
            onStartOver.fire('startover', {'handler': 'topologypoint'});
        });

        handler.on('added', function (e) { 
            drawncallback(e.marker);
        });
    };
    
    module.init = function(map, bounds, fitToBounds) {
        fitToBounds = fitToBounds === undefined ? true : fitToBounds;

        map.removeControl(map.attributionControl);

        map.addControl(new L.Control.Measurement());

        /*** <Map bounds and reset> ***/

        var initialBounds = bounds,
            objectBounds = module_settings.init.objectBounds,
            currentBounds = objectBounds || initialBounds;

        var getBounds = function () {
            return currentBounds;
        };

        if (fitToBounds) {
            map.fitBounds(currentBounds);
        }

        map.addControl(new L.Control.ResetView(getBounds));
        map.addControl(new L.Control.Scale());

        // Show other objects of same type
        var modelname = $('form input[name="model"]').val(),
            objectsLayer = module.addObjectsLayer(map, modelname);

        // Enable snapping ? Multipath need path snapping too !
        var path_snapping = module_settings.init.pathsnapping || module_settings.init.multipath,
            snapObserver = null;
        MapEntity.MarkerSnapping.prototype.SNAP_DISTANCE = module_settings.enablePathSnapping.SNAP_DISTANCE;

        if (path_snapping) {
            snapObserver = module.enablePathSnapping(map, modelname, objectsLayer);
        }

        var layerStore = MapEntity.makeGeoFieldProxy($(module_settings.init.layerStoreElemSelector));
        layerStore.setTopologyMode(module_settings.init.multipath || module_settings.init.topologypoint);

        /*** <objectLayer> ***/

        function _edit_handler(map, layer) {
            var edit_handler = L.Handler.PolyEdit;
            if (path_snapping) {
                edit_handler = L.Handler.SnappedEdit;
                if (layer instanceof L.Marker) {
                    edit_handler =  MapEntity.MarkerSnapping;
                }
            }
            return new edit_handler(map, layer);
        };

        function onNewLayer(new_layer) {
            if (new_layer instanceof L.Marker) {
                currentBounds = map.getBounds(); // A point has no bounds, take map bounds
                // Set custom icon, using CSS instead of JS
                new_layer.setIcon(new L.Icon({
                        iconUrl: module_settings.init.iconUrl,
                        shadowUrl: module_settings.init.shadowUrl,
                        iconSize: new L.Point(25, 41),
                        iconAnchor: new L.Point(13, 41),
                        popupAnchor: new L.Point(1, -34),
                        shadowSize: new L.Point(41, 41)
                    }));
                $(new_layer._icon).addClass('marker-add');
                
            }
            else {
                currentBounds = new_layer.getBounds();
            }
            new_layer.editing = _edit_handler(map, new_layer);
            new_layer.editing.enable();
            new_layer.on('move edit', function (e) {
                layerStore.storeLayerGeomInField(e.target);
            });
            layerStore.storeLayerGeomInField(new_layer);
            if (snapObserver) snapObserver.add(new_layer);
        }

        var geojson = module_settings.init.geojson;  // If no field, will be null.
        if (geojson) {
            var objectLayer = new L.GeoJSON(geojson, {
                style: {weight: 5, opacity: 1, clickable: true},
                onEachFeature: function (feature, layer) {
                    onNewLayer(layer);
                }
            });
            map.addLayer(objectLayer);
        }

        /*** </objectLayer> ***/

        /*** <drawing> ***/

        var onDrawn = function (drawn_layer) {
            map.addLayer(drawn_layer);
            onNewLayer(drawn_layer);
        };

        var removeLayerFromLayerStore = function () {
            var old_layer = layerStore.getLayer();
            if (old_layer) {
                map.removeLayer(old_layer);
                if (snapObserver) snapObserver.remove(old_layer);
                currentBounds = initialBounds;
                layerStore.storeLayerGeomInField(null);
            }
        };

        var onStartOver = L.Util.extend({}, L.Mixin.Events);
        onStartOver.on('startover', removeLayerFromLayerStore);
        
        if (module_settings.init.enableDrawing) {
            module.enableDrawing(map, onDrawn, removeLayerFromLayerStore);
        }

        if (module_settings.init.multipath) {
            module.enableMultipath(map, snapObserver.guidesLayer(), layerStore, onStartOver, snapObserver);
        }
        
        if (module_settings.init.topologypoint) {
            module.enableTopologyPoint(map, onDrawn, onStartOver);
        }
    };

    return module;
};
