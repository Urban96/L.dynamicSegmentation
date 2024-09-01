L.DynamicSegmentation = L.Layer.extend({
    initialize: function(options) {
        L.setOptions(this, options);
        this._segments = [];
        this._dynamicDataUrl = options.dynamicDataUrl;
        this._styleConfig = this._parseStyleOptions(options.style || {});
    },

    onAdd: function(map) {
        this._map = map;
        this._loadBaseData();
    },

    _loadBaseData: function() {
        var that = this;
    
        fetch(this.options.baseDataUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Base data fetch error: ' + response.statusText);
                }
                return response.json();
            })
            .then(baseData => {
                that._baseLayer = L.geoJSON(baseData, {
                    style: { color: 'blue' }
                });
                that._loadDynamicData();
            })
            .catch(error => {
                console.error('Error loading base data:', error);
                L.popup()
                    .setLatLng(that._map.getCenter())
                    .setContent('Error loading base data. Please try again later.')
                    .openOn(that._map);
            });
    },

    _validateDynamicData: function(data) {
        return data.features.every(feature => {
            return feature.properties[this.options.idAttribute] &&
                   feature.properties[this.options.startAttribute] >= 0 &&
                   feature.properties[this.options.endAttribute] >= feature.properties[this.options.startAttribute] &&
                   feature.properties[this.options.styleAttribute];
        });
    },
    

    _loadDynamicData: function() {
        var that = this;
    
        fetch(this._dynamicDataUrl)
            .then(response => response.json())
            .then(dynamicData => {
                if (!that._validateDynamicData(dynamicData)) {
                    console.error('Invalid dynamic data format.');
                    throw new Error('Invalid dynamic data format.');
                }
                that._processDynamicData(dynamicData);
            })
            .catch(error => {
                console.error('Error loading dynamic data:', error);
                L.popup()
                    .setLatLng(that._map.getCenter())
                    .setContent('Error loading dynamic data. Please try again later.')
                    .openOn(that._map);
            });
    },

    _processDynamicData: function(dynamicData) {
        var that = this;
        var features = [];
        var idAttr = this.options.idAttribute;
        var startAttr = this.options.startAttribute;
        var endAttr = this.options.endAttribute;
    
        this._baseLayer.eachLayer(function(layer) {
            var baseCoords = layer.feature.geometry.coordinates;
            if (layer.feature.geometry.type === 'MultiLineString') {
                baseCoords.forEach(function(lineCoords) {
                    var totalLength = that._calculateLineLength(lineCoords);
    
                    var segments = dynamicData.features
                        .filter(segment => segment.properties[idAttr] === layer.feature.properties[idAttr])
                        .map(segment => ({
                            start: segment.properties[startAttr],
                            end: segment.properties[endAttr],
                            value: segment.properties[that.options.styleAttribute]
                        }));
    
                    if (segments.length > 0) {
                        let lastSegment = segments[segments.length - 1];
                        if (lastSegment.end < totalLength) {
                            segments.push({
                                start: lastSegment.end,
                                end: totalLength,
                                value: lastSegment.value
                            });
                        }
                    } else {
                        segments = [{
                            start: 0,
                            end: totalLength,
                            value: 0
                        }];
                    }
    
                    var segmentFeatures = that._segmentLineByRealDistance(lineCoords, segments);
                    features = features.concat(segmentFeatures);
                });
            } else {
                var totalLength = that._calculateLineLength(baseCoords);
    
                var segments = dynamicData.features
                    .filter(segment => segment.properties[idAttr] === layer.feature.properties[idAttr])
                    .map(segment => ({
                        start: segment.properties[startAttr],
                        end: segment.properties[endAttr],
                        value: segment.properties[that.options.styleAttribute]
                    }));
    
                if (segments.length > 0) {
                    let lastSegment = segments[segments.length - 1];
                    if (lastSegment.end < totalLength) {
                        segments.push({
                            start: lastSegment.end,
                            end: totalLength,
                            value: lastSegment.value
                        });
                    }
                } else {
                    segments = [{
                        start: 0,
                        end: totalLength,
                        value: 0
                    }];
                }
    
                var segmentFeatures = that._segmentLineByRealDistance(baseCoords, segments);
                features = features.concat(segmentFeatures);
            }
        });

    
        if (this._segmentLayer) {
            this._map.removeLayer(this._segmentLayer);
        }
        
        this._segmentLayer = L.geoJSON(features, {
            style: that._styleSegment.bind(that),
            onEachFeature: that._onEachFeature.bind(that)
        }).addTo(that._map);
    },

    _calculateLineLength: function(coords) {
        var length = 0;
        for (var i = 0; i < coords.length - 1; i++) {
            length += this._map.distance(
                [coords[i][1], coords[i][0]],
                [coords[i + 1][1], coords[i + 1][0]]
            );
        }
        return length / 1000;
    },

    _findPointIndexForDistance: function(coords, targetDistance) {
        var cumulativeDistance = 0;
        for (var i = 0; i < coords.length - 1; i++) {
            var segmentLength = this._map.distance(
                [coords[i][1], coords[i][0]],
                [coords[i + 1][1], coords[i + 1][0]]
            ) / 1000;
            cumulativeDistance += segmentLength;

            if (cumulativeDistance >= targetDistance) {
                return i;
            }
        }
        return coords.length - 2;
    },

    _segmentLineByRealDistance: function(lineCoords, segments) {
        var segmentFeatures = [];

        segments.forEach(segment => {
            var startIdx = this._findPointIndexForDistance(lineCoords, segment.start);
            var endIdx = this._findPointIndexForDistance(lineCoords, segment.end);

            endIdx = Math.min(endIdx, lineCoords.length - 1);

            var segmentCoords = lineCoords.slice(startIdx, endIdx + 2);

            if (segmentCoords.length > 1) {
                segmentFeatures.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: segmentCoords
                    },
                    properties: {
                        [this.options.startAttribute]: segment.start,
                        [this.options.endAttribute]: segment.end,
                        [this.options.styleAttribute]: segment.value
                    }
                });
            }
        });

        return segmentFeatures;
    },

    _styleSegment: function(feature) {
        var value = feature.properties[this.options.styleAttribute];
        var color = this._getColorForValue(value);

        return {
            color: color,
            weight: 4
        };
    },

    _getColorForValue: function(value) {
        var styleConfig = this._styleConfig;
    
        for (var interval in styleConfig.intervals) {
            var [min, max, color] = styleConfig.intervals[interval];
            if (value >= min && value <= max) {
                return color;
            }
        }
    
        return styleConfig.exact[value] || 'grey';
    },

    _parseStyleOptions: function(styleOptions) {
        var parsedStyles = {
            intervals: {},
            exact: {}
        };
    
        for (var key in styleOptions) {
            var value = styleOptions[key];
    
            if (key.includes('-')) {
                var [min, max] = key.split('-').map(Number);
                parsedStyles.intervals[key] = [min, max, value];
            } else {
                parsedStyles.exact[key] = value;
            }
        }
        return parsedStyles;
    },

    _onEachFeature: function(feature, layer) {
        if (this.options.showPopup) {
            layer.on('mouseover', function(e) {
                var popupContent = this._createPopupContent(feature);

                this._popup = L.popup()
                    .setLatLng(e.latlng)
                    .setContent(popupContent)
                    .openOn(this._map);
            }.bind(this));

            layer.on('mouseout', function() {
                if (this._popup) {
                    this._map.closePopup(this._popup);
                    this._popup = null;
                }
            }.bind(this));
        }
    },

    _createPopupContent: function(feature) {
        var props = feature.properties;
        var content = `<strong>Start</strong> ${props[this.options.startAttribute]}<br>`;
        content += `<strong>End:</strong> ${props[this.options.endAttribute]}<br>`;
        content += `<strong>Value:</strong> ${props[this.options.styleAttribute]}`;
        return content;
    },

    updateDynamicData: function(newUrl) {
        this._dynamicDataUrl = newUrl;
        this._loadDynamicData();
    },

    updateStyleConfig: function(newStyleConfig) {
        this._styleConfig = this._parseStyleOptions(newStyleConfig);
        if (this._segmentLayer) {
            this._segmentLayer.setStyle(this._styleSegment.bind(this));
        }
    },

    clearSegments: function() {
        if (this._segmentLayer) {
            this._map.removeLayer(this._segmentLayer);
            this._segmentLayer = null;
        }
    }
    
});

L.dynamicSegmentation = function(options) {
    return new L.DynamicSegmentation(options);
};