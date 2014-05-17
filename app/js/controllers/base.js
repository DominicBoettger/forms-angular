'use strict';

var fng = angular.module('formsAngular');

fng.controller( 'BaseCtrl',
[                                                   // $data is a hacked up 'global' and must die
    '$scope', '$routeParams', '$modal', '$filter', '$data', '$window', 'SubmissionsService', 'SchemasService', 'tele', '$log'
,
function ($scope, $routeParams, $modal, $filter, $data, $window, SubmissionsService, SchemasService, tele, $log) {

    var master = {};
    var fngInvalidRequired = 'fng-invalid-required';
    var sharedStuff = $data;
    var allowLocationChange = true;   // Set when the data arrives..

    sharedStuff.baseScope = $scope;
    $scope.record = sharedStuff.record;

    // only used on list pages
    $scope.page_size = 20;
    $scope.pages_loaded = 0;


    // should be converted to an event instead of having form-input.js set up watches on this 'phase' thingy
    $scope.phase = 'init';

    $scope.disableFunctions = sharedStuff.disableFunctions;
    $scope.dataEventFunctions = sharedStuff.dataEventFunctions;

    $scope.topLevelFormName = undefined;

    $scope.formSchema = [];     // schema for the form view
    $scope.tabs = [];
    $scope.listSchema = [];     // schema for the list view
    $scope.recordList = [];
    $scope.dataDependencies = {};
    $scope.select2List = [];

    // state management cruft: needs to be refactored
    $scope.index = false;
    $scope.analyse = false;
    $scope.newRecord = false;

    var pathParts = tele.activePath().split('/');
    if (pathParts.lastIndexOf('index') === pathParts.length - 1) {
        $scope.index = true;
    }
    if (pathParts.indexOf('analyse') !== -1) {
        $scope.analyse = true;
    } else if (pathParts.indexOf('new') !== -1) {
        $scope.newRecord = true;
    } else if (pathParts.indexOf('edit') !== -1) {
        // ?
    }

    $scope.modelName = $routeParams.modelName;
    $scope.formName  = $routeParams.formName;

    if ($routeParams.id !== undefined) {
        $scope.id = $routeParams.id;
    }

    $scope.modelNameDisplay = sharedStuff.modelNameDisplay || $filter('titleCase')($scope.modelName);


    //console.log('modelName: ' + $scope.modelName + ', formName: ' + $scope.formName + ', id: ' + $scope.id);


    // load up the schema
    SchemasService.getSchema($scope.modelName, $scope.formName)
        .success( function (data) {
            handleSchema('Main ' + $scope.modelName, data, $scope.formSchema, $scope.listSchema, '', true);

            if (!$scope.id && !$scope.newRecord) { //this is a list. listing out contents of a collection
                allowLocationChange = true;
            } else {
                var force = true;
                $scope.$watch('record', function (newValue, oldValue) {
                    if (newValue !== oldValue) {
                        force = $scope.updateDataDependentDisplay(newValue, oldValue, force);
                    }
                }, true);

                if ($scope.id && callBeforeReadListeners($scope.id)) {
                    readRecord();
                } else {
                    // New record
                    master = {};
                    $scope.phase = 'ready';
                    $scope.cancel();
                }
            }
        })
        .error(function () {
            tele.path('error', [404]);
        });

    var readRecord = function () {
        SubmissionsService.readRecord($scope.modelName, $scope.id)
            .success(function (data) {
                if (data.success === false) {
                    tele.path('error', [404]);
                }
                allowLocationChange = false;
                $scope.phase = 'reading';
                if (typeof $scope.dataEventFunctions.onAfterRead === 'function') {
                    $scope.dataEventFunctions.onAfterRead(data);
                }
                processServerData(data);
            }).error(function () {
                tele.path('error', [404]);
            });
    };

    // used by converters from AngularJS <--> MongoDB
    var walkTree = function (object, fieldname, element) {
        // Walk through subdocs to find the required key
        // for instance walkTree(master,'address.street.number',element)
        // called by getData and setData

        // element is used when accessing in the context of a input, as the id (like exams-2-grader)
        // gives us the element of an array (one level down only for now)
        // TODO: nesting breaks this
        var parts = fieldname.split('.')
            , higherLevels = parts.length - 1
            , workingRec = object;

        for (var i = 0; i < higherLevels; i++) {
            workingRec = workingRec[parts[i]];
            if (angular.isArray(workingRec)) {
                // If we come across an array we need to find the correct position
                workingRec = workingRec[element.scope().$index]
            }
            if (!workingRec) {
                break;
            }
        }
        return {lastObject: workingRec, key: workingRec ? parts[higherLevels] : undefined};
    };

    var getData = function (object, fieldname, element) {
        var leafData = walkTree(object, fieldname, element);
        return (leafData.lastObject && leafData.key) ? leafData.lastObject[leafData.key] : undefined;
    };

    var setData = function (object, fieldname, element, value) {
        var leafData = walkTree(object, fieldname, element);
        leafData.lastObject[leafData.key] = value;
    };

    var updateInvalidClasses = function (value, id, select2) {
        var target = '#' + ((select2) ? 'cg_' : '') + id;
        if (value) {
            $(target).removeClass(fngInvalidRequired);
        } else {
            $(target).addClass(fngInvalidRequired);
        }
    };

    var suffixCleanId = function (inst, suffix) {
        return (inst.id || 'f_' + inst.name).replace(/\./g, '_') + suffix;
    };

    var handleFieldType = function (formInstructions, mongooseType, mongooseOptions) {
        var select2ajaxName;
        if (mongooseType.caster) {
            formInstructions.array = true;
            mongooseType = mongooseType.caster;
            $.extend(mongooseOptions, mongooseType.options)
        }
        if (mongooseType.instance == 'String') {
            if (mongooseOptions.enum) {
                formInstructions.type = formInstructions.type || 'select';
                // Hacky way to get required styling working on select controls
                if (mongooseOptions.required) {

                    $scope.$watch('record.' + formInstructions.name, function (newValue) {
                        updateInvalidClasses(newValue, formInstructions.id, formInstructions.select2);
                    }, true);
                    setTimeout(function () {
                        updateInvalidClasses($scope.record[formInstructions.name], formInstructions.id, formInstructions.select2);
                    }, 0)
                }
                if (formInstructions.select2) {
                    $scope['select2' + formInstructions.name] = {
                        allowClear: !mongooseOptions.required,
                        initSelection: function (element, callback) {
                            callback(element.select2('data'));
                        },
                        query: function (query) {
                            var data = {results: []},
                                searchString = query.term.toUpperCase();
                            for (var i = 0; i < mongooseOptions.enum.length; i++) {
                                if (mongooseOptions.enum[i].toUpperCase().indexOf(searchString) !== -1) {
                                    data.results.push({id: i, text: mongooseOptions.enum[i]})
                                }
                            }
                            query.callback(data);
                        }
                    };
                    _.extend($scope['select2' + formInstructions.name], formInstructions.select2);
                    formInstructions.select2.s2query = 'select2' + formInstructions.name;
                    $scope.select2List.push(formInstructions.name)
                } else {
                    formInstructions.options = suffixCleanId(formInstructions, 'Options');
                    $scope[formInstructions.options] = mongooseOptions.enum;
                }
            } else {
                if (!formInstructions.type) {
                    formInstructions.type = (formInstructions.name.toLowerCase().indexOf('password') !== -1) ? 'password' : 'text';
                }
                if (mongooseOptions.match) {
                    formInstructions.add = 'pattern="' + mongooseOptions.match + '" ' + (formInstructions.add || '');
                }
            }
        } else if (mongooseType.instance == 'ObjectID') {
            formInstructions.ref = mongooseOptions.ref;
            if (formInstructions.link && formInstructions.link.linkOnly) {
                formInstructions.type = 'link';
                formInstructions.linkText = formInstructions.link.text;
                formInstructions.form = formInstructions.link.form;
                delete formInstructions.link;
            } else {
                formInstructions.type = 'select';
                if (formInstructions.select2) {
                    $scope.select2List.push(formInstructions.name);
                    if (formInstructions.select2.fngAjax) {
                        // create the instructions for select2
                        select2ajaxName = 'ajax' + formInstructions.name.replace(/\./g, '');
                        $scope[select2ajaxName] = {
                            allowClear: !mongooseOptions.required,
                            minimumInputLength: 2,
                            initSelection: function (element, callback) {
                                var theId = element.val();
                                if (theId && theId !== '') {

                                    SubmissionsService.getListAttributes(mongooseOptions.ref, theId)
                                        .success(function (data) {
                                            if (data.success === false) {
                                                tele.path('error', [404]);
                                            }
                                            var display = {id: theId, text: data.list};
                                            setData(master, formInstructions.name, element, display);
                                            // stop the form being set to dirty
                                            var modelController = element.inheritedData('$ngModelController')
                                                , isClean = modelController.$pristine;
                                            if (isClean) {
                                                // fake it to dirty here and reset after callback()
                                                modelController.$pristine = false;
                                            }
                                            callback(display);
                                            if (isClean) {
                                                modelController.$pristine = true;
                                            }
                                        }).error(function () {
                                            tele.path('error', [404]);
                                        });
                                    // } else {
                                    // throw new Error('select2 initSelection called without a value');
                                }
                            },
                            ajax: {
                                url: "/api/search/" + mongooseOptions.ref,
                                data: function (term, page) { // page is the one-based page number tracked by Select2
                                    return {
                                        q: term, //search term
                                        page_limit: 10, // page size
                                        page: page // page number
                                    }
                                },
                                results: function (data) {
                                    return {results: data.results, more: data.moreCount > 0};
                                }
                            }
                        };
                        _.extend($scope[select2ajaxName], formInstructions.select2);
                        formInstructions.select2.fngAjax = select2ajaxName;
                    } else {
                        if (formInstructions.select2 == true) {
                            formInstructions.select2 = {};
                        }
                        $scope['select2' + formInstructions.name] = {
                            allowClear: !mongooseOptions.required,
                            initSelection: function (element, callback) {
                                var myId = element.val();
                                if (myId !== '' && $scope[formInstructions.ids].length > 0) {
                                    var myVal = convertIdToListValue(myId, $scope[formInstructions.ids], $scope[formInstructions.options], formInstructions.name);
                                    var display = {id: myId, text: myVal};
                                    callback(display);
                                }
                            },
                            query: function (query) {
                                var data = {results: []},
                                    searchString = query.term.toUpperCase();
                                for (var i = 0; i < $scope[formInstructions.options].length; i++) {
                                    if ($scope[formInstructions.options][i].toUpperCase().indexOf(searchString) !== -1) {
                                        data.results.push({id: $scope[formInstructions.ids][i], text: $scope[formInstructions.options][i]})
                                    }
                                }
                                query.callback(data);
                            }
                        };
                        _.extend($scope['select2' + formInstructions.name], formInstructions.select2);
                        formInstructions.select2.s2query = 'select2' + formInstructions.name;
                        $scope.select2List.push(formInstructions.name);
                        formInstructions.options = suffixCleanId(formInstructions, 'Options');
                        formInstructions.ids = suffixCleanId(formInstructions, '_ids');
                        setUpSelectOptions(mongooseOptions.ref, formInstructions);
                    }
                } else {
                    formInstructions.options = suffixCleanId(formInstructions, 'Options');
                    formInstructions.ids = suffixCleanId(formInstructions, '_ids');
                    setUpSelectOptions(mongooseOptions.ref, formInstructions);
                }
            }
        } else if (mongooseType.instance == 'Date') {
            if (!formInstructions.type) {
                if (formInstructions.readonly) {
                    formInstructions.type = 'text';
                } else {
                    formInstructions.type = 'text';
                    formInstructions.add = 'ui-date ui-date-format ';
                }
            }
        } else if (mongooseType.instance == 'boolean') {
            formInstructions.type = 'checkbox';
        } else if (mongooseType.instance == 'Number') {
            formInstructions.type = 'number';
            if (mongooseOptions.min) {
                formInstructions.add = 'min="' + mongooseOptions.min + '" ' + (formInstructions.add || '');
            }
            if (mongooseOptions.max) {
                formInstructions.add = 'max="' + mongooseOptions.max + '" ' + (formInstructions.add || '');
            }
            if (formInstructions.step) {
                formInstructions.add = 'step="' + formInstructions.step + '" ' + (formInstructions.add || '');
            }
        } else {
            throw new Error("Field " + formInstructions.name + " is of unsupported type " + mongooseType.instance);
        }
        if (mongooseOptions.required) {
            formInstructions.required = true;
        }
        if (mongooseOptions.readonly) {
            formInstructions.readonly = true;
        }
        return formInstructions;
    };

    // TODO: Do this in form
    var basicInstructions = function (field, formData, prefix) {
        formData.name = prefix + field;
        // formData.id = formData.id || 'f_' + prefix + field.replace(/\./g, '_');
        // formData.label = (formData.hasOwnProperty('label') && formData.label) == null ? '' : (formData.label || $filter('titleCase')(field));
        return formData;
    };

    var handleListInfo = function (destList, listOptions, field) {
        var listData = listOptions || {hidden: true};
        if (!listData.hidden) {
            if (typeof listData == "object") {
                listData.name = field;
                destList.push(listData);
            } else {
                destList.push({name: field});
            }
        }
    };

    var handleEmptyList = function (description, destList, destForm, source) {
        // If no list fields specified use the first non hidden string field
        if (destForm) {
            for (var i = 0, l = destForm.length; i < l; i++) {
                if (destForm[i].type == 'text') {
                    destList.push({name: destForm[i].name});
                    break;
                }
            }
            if (destList.length === 0 && destForm.length !== 0) {
                // If it is still blank then just use the first field
                destList.push({name: destForm[0].name});
            }
        }

        if (destList.length === 0) {
            // If it is still blank then just use the first field from source
            for (var field in source) {
                if (field !== '_id' && source.hasOwnProperty(field)) {
                    destList.push({name: field});
                    break;
                }
            }
            if (destList.length === 0) {
                throw new Error("Unable to generate a title for " + description)
            }
        }
    };

    var evaluateConditional = function (condition, data) {

        function evaluateSide(side) {
            var result = side;
            if (typeof side === "string" && side.slice(0, 1) === '$') {
                var sideParts = side.split('.');
                switch (sideParts.length) {
                    case 1:
                        result = $scope.getListData(data, side.slice(1));
                        break;
                    case 2 :
                        // this is a sub schema element, and the appropriate array element has been passed
                        result = $scope.getListData(data, sideParts[1]);
                        break;
                    default:
                        throw new Error("Unsupported showIf format")
                }
            }
            return result;
        }

        var lhs = evaluateSide(condition.lhs)
            , rhs = evaluateSide(condition.rhs)
            , result;

        switch (condition.comp) {
            case 'eq' :
                result = (lhs === rhs);
                break;
            case 'ne' :
                result = (lhs !== rhs);
                break;
            default :
                throw new Error("Unsupported comparator " + condition.comp);
        }
        return result;
    };

    // Conditionals
    // $scope.dataDependencies is of the form {fieldName1: [fieldId1, fieldId2], fieldName2:[fieldId2]}
    var handleConditionals = function (condInst, name) {

        var dependency = 0;

        function handleVar(theVar) {
            if (typeof theVar === "string" && theVar.slice(0, 1) === '$') {
                var fieldName = theVar.slice(1);
                var fieldDependencies = $scope.dataDependencies[fieldName] || [];
                fieldDependencies.push(name);
                $scope.dataDependencies[fieldName] = fieldDependencies;
                dependency += 1;
            }
        }

        var display = true;
        if (condInst) {
            handleVar(condInst.lhs);
            handleVar(condInst.rhs);
            if (dependency === 0 && !evaluateConditional(condInst)) {
                display = false;
            }
        }
        return display;
    };

    var setUpSelectOptions = function (lookupCollection, schemaElement) {
        var optionsList = $scope[schemaElement.options] = [];
        var idList = $scope[schemaElement.ids] = [];

        SchemasService.getSchema(lookupCollection)
            .success(function (data) {
                var listInstructions = [];
                handleSchema('Lookup ' + lookupCollection, data, null, listInstructions, '', false);

                SubmissionsService.getAll(lookupCollection)
                    .success(function (data) {
                        if (data) {
                            for (var i = 0; i < data.length; i++) {
                                var option = '';
                                for (var j = 0; j < listInstructions.length; j++) {
                                    option += data[i][listInstructions[j].name] + ' ';
                                }
                                option = option.trim();
                                var pos = _.sortedIndex(optionsList, option);
                                // handle dupes (ideally people will use unique indexes to stop them but...)
                                if (optionsList[pos] === option) {
                                    option = option + '    (' + data[i]._id + ')';
                                    pos = _.sortedIndex(optionsList, option);
                                }
                                optionsList.splice(pos, 0, option);
                                idList.splice(pos, 0, data[i]._id);
                            }
                            updateRecordWithLookupValues(schemaElement);
                        }
                    });
            });
    };

    var handleError = function (data, status) {
        if ([200, 400].indexOf(status) !== -1) {
            var errorMessage = '';
            for (var errorField in data.errors) {
                if (data.errors.hasOwnProperty(errorField)) {
                    errorMessage += '<li><b>' + $filter('titleCase')(errorField) + ': </b> ';
                    switch (data.errors[errorField].type) {
                        case 'enum' :
                            errorMessage += 'You need to select from the list of values';
                            break;
                        default:
                            errorMessage += data.errors[errorField].message;
                            break;
                    }
                    errorMessage += '</li>'
                }
            }
            if (errorMessage.length > 0) {
                errorMessage = data.message + '<br /><ul>' + errorMessage + '</ul>';
            } else {
                errorMessage = data.message || "Error!  Sorry - No further details available.";
            }
            showError(errorMessage);
        } else {
            showError(status + ' ' + JSON.stringify(data));
        }
    };

    var showError = function (errString, alertTitle) {
        $scope.alertTitle = alertTitle ? alertTitle : "Error!";
        $scope.errorMessage = errString;

        console.log(errString);
    };

    // Split a field name into the next level and all following levels
    var splitFieldName = function (aFieldName) {
        var nesting = aFieldName.split('.'),
            result = [nesting[0]];

        if (nesting.length > 1) {
            result.push(nesting.slice(1).join('.'));
        }

        return result;
    };

    var updateObject = function (aFieldName, portion, fn) {
        var fieldDetails = splitFieldName(aFieldName);

        if (fieldDetails.length > 1) {
            updateArrayOrObject(fieldDetails[1], portion[fieldDetails[0]], fn);
        } else if (portion[fieldDetails[0]]) {
            var theValue = portion[fieldDetails[0]];
            portion[fieldDetails[0]] = fn((typeof theValue === 'Object') ? (theValue.x || theValue.id ) : theValue)
        }
    };

    var updateArrayOrObject = function (aFieldName, portion, fn) {
        if (portion !== undefined) {
            if ($.isArray(portion)) {
                for (var i = 0; i < portion.length; i++) {
                    updateObject(aFieldName, portion[i], fn);
                }
            } else {
                updateObject(aFieldName, portion, fn);
            }
        }
    };

    var simpleArrayNeedsX = function (aSchema) {
        var result = false;
        if (aSchema.type === 'text') {
            result = true;
        } else if ((aSchema.type === 'select') && !aSchema.ids) {
            result = true;
        }
        return result;
    };

    // Convert {_id:'xxx', array:['item 1'], lookup:'012abcde'} to {_id:'xxx', array:[{x:'item 1'}], lookup:'List description for 012abcde'}
    // Which is what we need for use in the browser
    var convertToAngularModel = function (schema, anObject, prefixLength) {
        for (var i = 0; i < schema.length; i++) {
            var fieldname = schema[i].name.slice(prefixLength);
            if (schema[i].schema) {
                if (anObject[fieldname]) {
                    for (var j = 0; j < anObject[fieldname].length; j++) {
                        anObject[fieldname][j] = convertToAngularModel(schema[i].schema, anObject[fieldname][j], prefixLength + 1 + fieldname.length);
                    }
                }
            } else {

                // Convert {array:['item 1']} to {array:[{x:'item 1'}]}
                var thisField = $scope.getListData(anObject, fieldname);
                if (schema[i].array && simpleArrayNeedsX(schema[i]) && thisField) {
                    for (var k = 0; k < thisField.length; k++) {
                        thisField[k] = {x: thisField[k]}
                    }
                }

                // Convert {lookup:'012abcde'} to {lookup:'List description for 012abcde'}
                var idList = $scope[suffixCleanId(schema[i], '_ids')];
                if (idList && idList.length > 0 && anObject[fieldname]) {
                    anObject[fieldname] = convertForeignKeys(schema[i], anObject[fieldname], $scope[suffixCleanId(schema[i], 'Options')], idList);
                } else if (schema[i].select2 && !schema[i].select2.fngAjax) {
                    if (anObject[fieldname]) {
                        // Might as well use the function we set up to do the search
                        $scope[schema[i].select2.s2query].query({
                            term: anObject[fieldname],
                            callback: function (array) {
                                if (array.results.length > 0) {
                                    anObject[fieldname] = array.results[0];
                                }
                            }});
                    }
                }
            }
        }
        return anObject;
    };

    // Reverse the process of convertToAngularModel
    var convertToMongoModel = function (schema, anObject, prefixLength) {

        for (var i = 0; i < schema.length; i++) {
            var fieldname = schema[i].name.slice(prefixLength);
            var thisField = $scope.getListData(anObject, fieldname);

            if (schema[i].schema) {
                if (thisField) {
                    for (var j = 0; j < thisField.length; j++) {
                        thisField[j] = convertToMongoModel(schema[i].schema, thisField[j], prefixLength + 1 + fieldname.length);
                    }
                }
            } else {

                // Convert {array:[{x:'item 1'}]} to {array:['item 1']}
                if (schema[i].array && simpleArrayNeedsX(schema[i]) && thisField) {
                    for (var k = 0; k < thisField.length; k++) {
                        thisField[k] = thisField[k].x
                    }
                }

                // Convert {lookup:'List description for 012abcde'} to {lookup:'012abcde'}
                var idList = $scope[suffixCleanId(schema[i], '_ids')];
                if (idList && idList.length > 0) {
                    updateObject(fieldname, anObject, function (value) {
                        return( convertToForeignKeys(schema[i], value, $scope[suffixCleanId(schema[i], 'Options')], idList) );
                    });
                } else if (schema[i].select2) {
                    var lookup = getData(anObject, fieldname, null);
                    if (schema[i].select2.fngAjax) {
                        if (lookup && lookup.id) {
                            setData(anObject, fieldname, null, lookup.id);
                        }
                    } else {
                        if (lookup) {
                            setData(anObject, fieldname, null, lookup.text);
                        } else {
                            setData(anObject, fieldname, null, undefined);
                        }
                    }
                }

            }
        }
        return anObject;
    };

    // Convert foreign keys into their display for selects
    // Called when the model is read and when the lookups are read
    // No support for nested schemas here as it is called from convertToAngularModel which does that
    var convertForeignKeys = function (schemaElement, input, values, ids) {
        if (schemaElement.array) {
            var returnArray = [];
            for (var j = 0; j < input.length; j++) {
                returnArray.push({x: convertIdToListValue(input[j], ids, values, schemaElement.name)});
            }
            return returnArray;
        } else if (schemaElement.select2) {
            return {id: input, text : convertIdToListValue(input, ids, values, schemaElement.name)};
        } else {
            return convertIdToListValue(input, ids, values, schemaElement.name);
        }
    };

    // Convert ids into their foreign keys
    // Called when saving the model
    // No support for nested schemas here as it is called from convertToMongoModel which does that
    var convertToForeignKeys = function (schemaElement, input, values, ids) {
        if (schemaElement.array) {
            var returnArray = [];
            for (var j = 0; j < input.length; j++) {
                returnArray.push(convertListValueToId(input[j], values, ids, schemaElement.name));
            }
            return returnArray;
        } else {
            return convertListValueToId(input, values, ids, schemaElement.name);
        }
    };

    var convertIdToListValue = function (id, idsArray, valuesArray, fname) {
        var index = idsArray.indexOf(id);
        if (index === -1) {
            throw new Error("convertIdToListValue: Invalid data - id " + id + " not found in " + idsArray + " processing " + fname)
        }
        return valuesArray[index];
    };

    var convertListValueToId = function (value, valuesArray, idsArray, fname) {
        var textToConvert = _.isObject(value) ? (value.x || value.text) : value;
        if (textToConvert && textToConvert.match(/^[0-9a-f]{24}$/)) {
            return(textToConvert);  // a plugin probably added this
        } else {
            var index = valuesArray.indexOf(textToConvert);
            if (index === -1) {
                throw new Error("convertListValueToId: Invalid data - value " + textToConvert + " not found in " + valuesArray + " processing " + fname)
            }
            return idsArray[index];
        }
    };

    var updateRecordWithLookupValues = function (schemaElement) {
        // Update the master and the record with the lookup values
        if (!$scope.topLevelFormName || $scope[$scope.topLevelFormName].$pristine) {
            updateObject(schemaElement.name, master, function (value) {
                return( convertForeignKeys(schemaElement, value, $scope[suffixCleanId(schemaElement, 'Options')], $scope[suffixCleanId(schemaElement, '_ids')]));
            });
            // TODO This needs a rethink - it is a quick workaround.  See https://trello.com/c/q3B7Usll
            if (master[schemaElement.name]) {
                $scope.record[schemaElement.name] = master[schemaElement.name];
            }
        }
    };

    var handleSchema = function (description, source, destForm, destList, prefix, doRecursion) {

        function handletabInfo(tabName, thisInst) {
            var tabTitle = angular.copy(tabName);
            var tab = _.find($scope.tabs, function (atab) {
                return atab.title === tabTitle
            });
            if (!tab) {
                if ($scope.tabs.length === 0) {
                    if ($scope.formSchema.length > 0) {
                        $scope.tabs.push({title: 'Main', content: []});
                        tab = $scope.tabs[0];
                        for (var i = 0; i < $scope.formSchema.length; i++) {
                            tab.content.push($scope.formSchema[i])
                        }
                    }
                }
                tab = $scope.tabs[$scope.tabs.push({title: tabTitle, containerType: 'tab', content: []}) - 1]
            }
            tab.content.push(thisInst);
        }

        for (var field in source) {
            if (field !== '_id' && source.hasOwnProperty(field)) {
                var mongooseType = source[field],
                    mongooseOptions = mongooseType.options || {};
                var formData = mongooseOptions.form || {};
                if (!formData.hidden) {
                    if (mongooseType.schema) {
                        if (doRecursion && destForm) {
                            var schemaSchema = [];
                            handleSchema('Nested ' + field, mongooseType.schema, schemaSchema, null, field + '.', true);
                            var sectionInstructions = basicInstructions(field, formData, prefix);
                            sectionInstructions.schema = schemaSchema;
                            if (formData.tab) handletabInfo(formData.tab, sectionInstructions);
                            if (formData.order !== undefined) {
                                destForm.splice(formData.order, 0, sectionInstructions);
                            } else {
                                destForm.push(sectionInstructions);
                            }
                        }
                    } else {
                        if (destForm) {
                            var formInstructions = basicInstructions(field, formData, prefix);
                            if (handleConditionals(formInstructions.showIf, formInstructions.name) && field !== 'options') {
                                var formInst = handleFieldType(formInstructions, mongooseType, mongooseOptions);
                                if (formInst.tab) handletabInfo(formInst.tab, formInst);
                                if (formData.order !== undefined) {
                                    destForm.splice(formData.order, 0, formInst);
                                } else {
                                    destForm.push(formInst);
                                }
                            }
                        }
                        if (destList) {
                            handleListInfo(destList, mongooseOptions.list, field);
                        }
                    }
                }
            }
        }
        if (destList && destList.length === 0) {
            handleEmptyList(description, destList, destForm, source);
        }
    };

    var setPristine = function() {
        $scope.dismissError();
        if ($scope[$scope.topLevelFormName]) {
            $scope[$scope.topLevelFormName].$setPristine();
        }
    };

    //----------------------------------------------------------------------------------------
    // internal. lower-level record operations
    var createRecord = function (modelName, dataToSave, options) {
        SubmissionsService.createRecord(modelName, dataToSave)
            .success(function (data) {
                if (!data.success !== false) {
                    if (typeof $scope.dataEventFunctions.onAfterCreate === "function") {
                        $scope.dataEventFunctions.onAfterCreate(data);
                    }
                    if (options.redirect) {
                        $window.location = options.redirect
                    } else {
                        tele.path('form', [modelName, $scope.formName, data._id, 'edit']);
                    }
                } else {
                    showError(data);
                }
            })
            .error(handleError);
    };

    var updateRecord = function (modelName, id, dataToSave, options) {
        $scope.phase = 'updating';

        SubmissionsService.updateRecord(modelName, id, dataToSave)
            .success(function (data) {
                if (data.success !== false) {
                    if (typeof $scope.dataEventFunctions.onAfterUpdate === "function") {
                        $scope.dataEventFunctions.onAfterUpdate(data, master)
                    }
                    if (options.redirect) {
                        if (options.allowChange) {
                            allowLocationChange = true;
                        }
                        $window.location = options.redirect;
                    } else {
                        processServerData(data);
                        setPristine();
                    }
                } else {
                    showError(data);
                }
            })
            .error(handleError);
    };

    var deleteRecord = function (modelName, id) {
        SubmissionsService.deleteRecord(modelName, id)
            .success(function () {
                if (typeof $scope.dataEventFunctions.onAfterDelete === "function") {
                    $scope.dataEventFunctions.onAfterDelete(master);
                }
                tele.path('form', [modelName]);
            });
    };

    //----------------------------------------------------------------------------------------
    // Record Event Listener processing - each returns true on success
    var callBeforeReadListeners = function (recordId) {
        var result = true
        if (typeof $scope.dataEventFunctions.onBeforeRead === 'function') {
            $scope.dataEventFunctions.onBeforeRead(recordId, function (err) {
                if (err) {
                    showError(err);
                    result = false;
                }
            });
        }
        return result;
    };

    var callBeforeUpdateListeners = function (dataToSave) {
        var result = true
        if (typeof $scope.dataEventFunctions.onBeforeUpdate === "function") {
            $scope.dataEventFunctions.onBeforeUpdate(dataToSave, master, function (err) {
                if (err) {
                    showError(err);
                    result = false;
                }
            });
        }
        return result;
    };

    var callBeforeCreateListeners = function (dataToSave) {
        var result = true;
        if (typeof $scope.dataEventFunctions.onBeforeCreate === "function") {
            $scope.dataEventFunctions.onBeforeCreate(dataToSave, function (err) {
                if (err) {
                    showError(err);
                    result = false;
                }
            });
        }
        return result;
    };

    var callBeforeDeleteListeners = function () {
        var result = true;
        if (typeof $scope.dataEventFunctions.onBeforeDelete === "function") {
            $scope.dataEventFunctions.onBeforeDelete(master, function (err) {
                if (err) {
                    showError(err);
                    result = false;
                }
            });
        }
        return result;
    };

    var processServerData = function(recordFromServer) {
        master = convertToAngularModel($scope.formSchema, recordFromServer, 0);
        $scope.phase = 'ready';
        $scope.cancel();
    };

    var setFormDirty = function (event) {
        if (event) {
            var form = angular.element(event.target).inheritedData('$formController');
            form.$setDirty();
        } else {
            console.log("setFormDirty called without an event (fine in a unit test)")
        }
    };



    //----------------------------------------------------------------------------------------
    // used in partials/base-list.html
    $scope.generateEditUrl = function(obj) {
        return tele.link('form', [$scope.modelName, $scope.formName, obj._id, 'edit']);
    };

    // used in partials/base-list.html and partials/base-edit.html
    // TODO: Think about nested arrays
    // This doesn't handle things like :
    // {a:"hhh",b:[{c:[1,2]},{c:[3,4]}]}
    $scope.getListData = function (record, fieldName) {
        var nests = fieldName.split('.');
        for (var i = 0; i < nests.length; i++) {
            if (record !== undefined) {
                record = record[nests[i]];
            }
        }
        if (record && $scope.select2List.indexOf(nests[i - 1]) !== -1) {
            record = record.text;
        }
        if (record === undefined) {
            record = "";
        }
        return record;
    };

    // used in form-input directive, which does not define an isolate scope
    // Conventional view is that this should go in a directive.  I reckon it is quicker here.
    $scope.updateDataDependentDisplay = function (curValue, oldValue, force) {
        var depends, i, j, k, element;

        var forceNextTime;
        for (var field in $scope.dataDependencies) {
            if ($scope.dataDependencies.hasOwnProperty(field)) {
                var parts = field.split('.');
                // TODO: what about a simple (non array) subdoc?
                if (parts.length === 1) {
                    if (force || !oldValue || curValue[field] != oldValue[field]) {
                        depends = $scope.dataDependencies[field];
                        for (i = 0; i < depends.length; i += 1) {
                            name = depends[i];
                            for (j = 0; j < $scope.formSchema.length; j += 1) {
                                if ($scope.formSchema[j].name === name) {
                                    element = angular.element('#cg_' + $scope.formSchema[j].id);
                                    if (evaluateConditional($scope.formSchema[j].showIf, curValue)) {
                                        element.removeClass('ng-hide');
                                    } else {
                                        element.addClass('ng-hide');
                                    }
                                }
                            }
                        }
                    }
                } else if (parts.length === 2) {
                    if (forceNextTime === undefined) {forceNextTime = true}
                    if (curValue[parts[0]]) {
                        for (k = 0; k < curValue[parts[0]].length; k++) {
                            // We want to carry on if this is new array element or it is changed
                            if (force || !oldValue || !oldValue[parts[0]] || !oldValue[parts[0]][k] || curValue[parts[0]][k][parts[1]] != oldValue[parts[0]][k][parts[1]]) {
                                depends = $scope.dataDependencies[field];
                                for (i = 0; i < depends.length; i += 1) {
                                    var nameParts = depends[i].split('.');
                                    if (nameParts.length !== 2) throw new Error("Conditional display must control dependent fields at same level ");
                                    for (j = 0; j < $scope.formSchema.length; j += 1) {
                                        if ($scope.formSchema[j].name === nameParts[0]) {
                                            var subSchema = $scope.formSchema[j].schema;
                                            for (var l = 0; l < subSchema.length; l++) {
                                                if (subSchema[l].name === depends[i]) {
                                                    element = angular.element('#f_'+nameParts[0]+'List_'+ k +' #cg_f_' + depends[i].replace('.', '_'));
                                                    if (element.length === 0) {
                                                        // Test Plait care plan structures if you change next line
                                                        element = angular.element('#f_elements-' + k + '-' + nameParts[1]);
                                                    } else {
                                                        forceNextTime = false;  // Because the sub schema has been rendered we don't need to do this again until the record changes
                                                    }
                                                    if (element.length > 0) {
                                                        if (evaluateConditional($scope.formSchema[j].schema[l].showIf, curValue[parts[0]][k])) {
                                                            element.show();
                                                        } else {
                                                            element.hide();
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // TODO: this needs rewrite for nesting
                    throw new Error("You can only go down one level of subdocument with showIf")
                }
            }
        }
        return forceNextTime;
    };

    // used in partials/base-list.html
    $scope.scrollTheList = function () {
        SubmissionsService.getPagedAndFilteredList($scope.modelName, {
                aggregate:  $routeParams.a,
                find:       $routeParams.f,
                limit:      $scope.page_size,
                skip:       $scope.pages_loaded * $scope.page_size,
                order:      $routeParams.o
            })
            .success(function (data) {
                if (angular.isArray(data)) {
                    $scope.pages_loaded++;
                    $scope.recordList = $scope.recordList.concat(data);
                } else {
                    showError(data, "Invalid query");
                }
            })
            .error(function () {
                tele.path('error', [404]);

            });
    };

    // used in partials/base-list.html, partials/base-edit.html and partials/base-analysis.html
    $scope.dismissError = function () {
        delete $scope.errorMessage;
    };

    //----------------------------------------------------------------------------------------
    // Record operations for button click actions
    $scope.save = function (options) {
        options = options || {};

        //Convert the lookup values into ids
        var dataToSave = convertToMongoModel($scope.formSchema, angular.copy($scope.record), 0);
        if ($scope.id) {
            if (callBeforeUpdateListeners(dataToSave)) {
                updateRecord($scope.modelName, $scope.id, dataToSave, options);
            }
        } else {
            if (callBeforeCreateListeners(dataToSave)) {
                createRecord($scope.modelName, dataToSave, options);
            }
        }
    };

    $scope.new = function () {
        //$location.search("");
        tele.path('form', [$scope.modelName, $scope.formName]);
    };

    $scope.delete = function () {
        if (!$scope.record._id) {
            return;
        }

        var modalInstance = $modal.open({
            templateUrl: 'partials/deleteRecordModalDialog.html',
            controller: 'SaveChangesModalCtrl',
            backdrop: 'static'
        });

        modalInstance.result
            .then( function (result) {
                if (result) {
                    if (callBeforeDeleteListeners()) {
                        deleteRecord($scope.modelName, $scope.id);
                    }
                }
            });
    };

    $scope.cancel = function () {
        for (var prop in $scope.record) {
            if ($scope.record.hasOwnProperty(prop)) {
                delete $scope.record[prop];
            }
        }

        $.extend(true, $scope.record, master);
        setPristine();
    };

    //----------------------------------------------------------------------------------------
    // button enable/disable states
    $scope.isCancelDisabled = function () {
        if (typeof $scope.disableFunctions.isCancelDisabled === "function") {
            return $scope.disableFunctions.isCancelDisabled($scope.record, master, $scope[$scope.topLevelFormName]);
        } else {
            return $scope[$scope.topLevelFormName] && $scope[$scope.topLevelFormName].$pristine;
        }
    };

    $scope.isSaveDisabled = function () {
        if (typeof $scope.disableFunctions.isSaveDisabled === "function") {
            return $scope.disableFunctions.isSaveDisabled($scope.record, master, $scope[$scope.topLevelFormName]);
        } else {
            return ($scope[$scope.topLevelFormName] && ($scope[$scope.topLevelFormName].$invalid || $scope[$scope.topLevelFormName].$pristine));
        }
    };

    $scope.isDeleteDisabled = function () {
        if (typeof $scope.disableFunctions.isDeleteDisabled === "function") {
            return $scope.disableFunctions.isDeleteDisabled($scope.record, master, $scope[$scope.topLevelFormName]);
        } else {
            return (!$scope.id);
        }
    };

    $scope.isNewDisabled = function () {
        if (typeof $scope.disableFunctions.isNewDisabled === "function") {
            return $scope.disableFunctions.isNewDisabled($scope.record, master, $scope[$scope.topLevelFormName]);
        } else {
            return false;
        }
    };

    // used in form-input directive
    // Open a select2 control from the appended search button
    $scope.openSelect2 = function (ev) {
        $('#' + $(ev.currentTarget).data('select2-open')).select2('open')
    };

    // used in partials/base-edit.htmlby adding the schema to the form-input directive's tag
    $scope.baseSchema = function () {
        return ($scope.tabs.length ? $scope.tabs : $scope.formSchema)
    }


    //listener for any child scopes to display messages
    // pass like this:
    //    scope.$emit('showErrorMessage', {title: 'Your error Title', body: 'The body of the error message'});
    // or
    //    scope.$broadcast('showErrorMessage', {title: 'Your error Title', body: 'The body of the error message'});
    $scope.$on('showErrorMessage', function (event, args) {
        showError(args.body, args.title);
    });

    $scope.$on('$locationChangeStart', function (event, next) {
        if (!allowLocationChange && !$scope.isCancelDisabled()) {
            event.preventDefault();
            var modalInstance = $modal.open({
                template:   '<div class="modal-header">' +
                            '   <h3>Record modified</h3>' +
                            '</div>' +
                            '<div class="modal-body">' +
                            '   <p>Would you like to save your changes?</p>' +
                            '</div>' +
                            '<div class="modal-footer">' +
                            '    <button class="btn btn-primary dlg-yes" ng-click="yes()">Yes</button>' +
                            '    <button class="btn btn-warning dlg-no" ng-click="no()">No</button>' +
                            '    <button class="btn dlg-cancel" ng-click="cancel()">Cancel</button>' +
                            '</div>',
                controller: 'SaveChangesModalCtrl',
                backdrop: 'static'
            });

            modalInstance.result.then(
                function (result) {
                    if (result) {
                        $scope.save({redirect: next, allowChange: true});    // save changes
                    } else {
                        allowLocationChange = true;
                        $window.location = next;
                    }
                }
            );
        }
    });
}]);



fng.controller( 'SaveChangesModalCtrl',
[
    '$scope', '$modalInstance'
,
function ($scope, $modalInstance) {
    $scope.yes = function () {
        $modalInstance.close(true);
    };
    $scope.no = function () {
        $modalInstance.close(false);
    };
    $scope.cancel = function () {
        $modalInstance.dismiss('cancel');
    };
}]);
