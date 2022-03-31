import {IDLBlob} from "./IDLBlob";
import {
  ClassObject,
  FunctionArguments,
  FunctionArgumentType,
  FunctionDeclaration,
  FunctionObject,
  PropsDeclaration,
} from "./declaration";
import {addIndent, getClassName} from "./utils";
import {ParameterType} from "./analyzer";
import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import {getTemplateKind, TemplateKind} from "./generateHeader";

enum PropType {
  hostObject,
  Element,
  Event
}

function generateMethodArgumentsCheck(m: FunctionDeclaration) {
  if (m.args.length == 0) return '';

  let requiredArgsCount = 0;
  m.args.forEach(m => {
    if (m.required) requiredArgsCount++;
  });

  return `  if (argc < ${requiredArgsCount}) {
    return JS_ThrowTypeError(ctx, "Failed to execute '${m.name}' : ${requiredArgsCount} argument required, but %d present.", argc);
  }
`;
}

export function generateTypeConverter(type: ParameterType[]): string {
  let haveNull = type.some(t => t === FunctionArgumentType.null);
  let returnValue = '';

  if (type[0] === FunctionArgumentType.array) {
    returnValue = `IDLSequence<${generateTypeConverter(type.slice(1))}>`;
  } else if (typeof type[0] === 'string') {
    returnValue = type[0];
  } else {
    switch(type[0]) {
      case FunctionArgumentType.int32:
        returnValue = `IDLInt32`;
        break;
      case FunctionArgumentType.int64:
        returnValue = 'IDLInt64';
        break;
      case FunctionArgumentType.double:
        returnValue = `IDLDouble`;
        break;
      case FunctionArgumentType.function:
        returnValue =  `IDLCallback`;
        break;
      case FunctionArgumentType.boolean:
        returnValue = `IDLBoolean`;
        break;
      case FunctionArgumentType.dom_string:
        returnValue = `IDLDOMString`;
        break;
      case FunctionArgumentType.object:
        returnValue = `IDLObject`;
        break;
      default:
      case FunctionArgumentType.any:
        returnValue = `IDLAny`;
        break;
    }
  }

  if (haveNull) {
    returnValue = `IDLNullable<${returnValue}>`;
  }

  return returnValue;
}

function generateRequiredInitBody(argument: FunctionArguments, argsIndex: number) {
  let type = generateTypeConverter(argument.type);
  return `auto&& args_${argument.name} = Converter<${type}>::FromValue(ctx, argv[${argsIndex}], exception_state);`;
}

function generateCallMethodName(name: string) {
  if (name === 'constructor') return 'Create';
  return name;
}

function generateOptionalInitBody(blob: IDLBlob, declare: FunctionDeclaration, argument: FunctionArguments, argsIndex: number, previousArguments: string[], options: GenFunctionBodyOptions) {
  let call = '';
  let returnValueAssignment = '';
  if (declare.returnType[0] != FunctionArgumentType.void) {
    returnValueAssignment = 'return_value =';
  }
  if (options.isInstanceMethod) {
    call = `auto* self = toScriptWrappable<${getClassName(blob)}>(this_val);
${returnValueAssignment} self->${generateCallMethodName(declare.name)}(${[...previousArguments, `args_${argument.name}`, 'exception_state'].join(',')});`;
  } else {
    call = `${returnValueAssignment} ${getClassName(blob)}::${generateCallMethodName(declare.name)}(context, ${[...previousArguments, `args_${argument.name}`].join(',')}, exception_state);`;
  }


  return `auto&& args_${argument.name} = Converter<IDLOptional<${generateTypeConverter(argument.type)}>>::FromValue(ctx, argv[${argsIndex}], exception_state);
if (exception_state.HasException()) {
  return exception_state.ToQuickJS();
}

if (argc <= ${argsIndex + 1}) {
  ${call}
  break;
}`;
}

function generateFunctionCallBody(blob: IDLBlob, declaration: FunctionDeclaration, options: GenFunctionBodyOptions = {isConstructor: false, isInstanceMethod: false}) {
  let minimalRequiredArgc = 0;
  declaration.args.forEach(m => {
    if (m.required) minimalRequiredArgc++;
  });

  let requiredArguments: string[] = [];
  let requiredArgumentsInit: string[] = [];
  if (minimalRequiredArgc > 0) {
    requiredArgumentsInit = declaration.args.filter((a, i) => a.required).map((a, i) => {
      requiredArguments.push(`args_${a.name}`);
      return generateRequiredInitBody(a, i);
    });
  }

  let optionalArgumentsInit: string[] = [];
  let totalArguments: string[] = requiredArguments.slice();

  for (let i = minimalRequiredArgc; i < declaration.args.length; i ++) {
    optionalArgumentsInit.push(generateOptionalInitBody(blob, declaration, declaration.args[i], i, totalArguments, options));
    totalArguments.push(`args_${declaration.args[i].name}`);
  }

  requiredArguments.push('exception_state');

  let call = '';
  let returnValueAssignment = '';
  if (declaration.returnType[0] != FunctionArgumentType.void) {
    returnValueAssignment = 'return_value =';
  }
  if (options.isInstanceMethod) {
    call = `auto* self = toScriptWrappable<${getClassName(blob)}>(this_val);
${returnValueAssignment} self->${generateCallMethodName(declaration.name)}(${minimalRequiredArgc > 0 ? `${requiredArguments.join(',')}` : 'exception_state'});`;
  } else {
    call = `${returnValueAssignment} ${getClassName(blob)}::${generateCallMethodName(declaration.name)}(context${minimalRequiredArgc > 0 ? `,${requiredArguments.join(',')}` : ''});`;
  }

  return `${requiredArgumentsInit.join('\n')}
if (argc <= ${minimalRequiredArgc}) {
  ${call}
  break;
}

${optionalArgumentsInit.join('\n')}
`;
}

function generateReturnValueInit(blob: IDLBlob, type: ParameterType[], options: GenFunctionBodyOptions = {isConstructor: false, isInstanceMethod: false}) {
  if (type[0] == FunctionArgumentType.void) return '';

  if (options.isConstructor) {
    return `${getClassName(blob)}* return_value = nullptr;`
  }
  if (typeof type[0] === 'string') {
    if (type[0] === 'Promise') {
      return 'ScriptPromise return_value;';
    } else {
      return `${type[0]}* return_value = nullptr;`;
    }
  }
  return `Converter<${generateTypeConverter(type)}>::ImplType return_value;`;
}

function generateReturnValueResult(blob: IDLBlob, type: ParameterType[], options: GenFunctionBodyOptions = {isConstructor: false, isInstanceMethod: false}): string {
  if (type[0] == FunctionArgumentType.void) return 'JS_NULL';
  if (options.isConstructor) {
    return `return_value->ToQuickJS()`;
  }

  if (typeof type[0] === 'string') {
    if (type[0] === 'Promise') {
      return 'return_value.ToQuickJS()';
    } else {
      return `return_value->ToQuickJS()`;
    }
  }

  return `Converter<${generateTypeConverter(type)}>::ToValue(ctx, std::move(return_value))`;
}

type GenFunctionBodyOptions = {isConstructor?: boolean, isInstanceMethod?: boolean};

function generateFunctionBody(blob: IDLBlob, declare: FunctionDeclaration, options: GenFunctionBodyOptions = {isConstructor: false, isInstanceMethod : false}) {
  let paramCheck = generateMethodArgumentsCheck(declare);
  let callBody = generateFunctionCallBody(blob, declare, options);
  let returnValueInit = generateReturnValueInit(blob, declare.returnType, options);
  let returnValueResult = generateReturnValueResult(blob, declare.returnType, options);

  return `${paramCheck}

  ExceptionState exception_state;
  ${returnValueInit}
  ExecutingContext* context = ExecutingContext::From(ctx);

  do {  // Dummy loop for use of 'break'.
${addIndent(callBody, 4)}
  } while (false);

  if (exception_state.HasException()) {
    return exception_state.ToQuickJS();
  }
  return ${returnValueResult};
`;
}

function readTemplate(name: string) {
  return fs.readFileSync(path.join(__dirname, '../../static/idl_templates/' + name + '.cc.tpl'), {encoding: 'utf-8'});
}

export function generateCppSource(blob: IDLBlob) {
  let globalFunctionInstallList: string[] = [];
  let classMethodsInstallList: string[] = [];
  let classPropsInstallList: string[] = [];
  let wrapperTypeInfoInit = '';
  const baseTemplate = fs.readFileSync(path.join(__dirname, '../../static/idl_templates/base.cc.tpl'), {encoding: 'utf-8'});

  const contents = blob.objects.map(object => {
    const templateKind = getTemplateKind(object);
    if (templateKind === TemplateKind.null) return '';

    switch(templateKind) {
      case TemplateKind.Interface: {
        object = object as ClassObject;
        object.props.forEach(prop => {
          classMethodsInstallList.push(`{"${prop.name}", ${prop.name}AttributeGetCallback, ${prop.readonly ? 'nullptr' : `${prop.name}AttributeSetCallback`}}`)
        });
        object.methods.forEach(method => {
          classPropsInstallList.push(`{"${method.name}", ${method.name}, ${method.args.length}}`)
        });
        wrapperTypeInfoInit = `
const WrapperTypeInfo wrapper_type_info_ {JS_CLASS_${getClassName(blob).toUpperCase()}, "${getClassName(blob)}", ${object.parent != null ? `${object.parent}::GetStaticWrapperTypeInfo()` : 'nullptr'}, QJS${getClassName(blob)}::ConstructorCallback};
const WrapperTypeInfo& ${getClassName(blob)}::wrapper_type_info_ = QJS${getClassName(blob)}::wrapper_type_info_;`;
        return _.template(readTemplate('interface'))({
          className: getClassName(blob),
          blob: blob,
          object: object,
          generateFunctionBody,
          generateTypeConverter
        });
      }
      case TemplateKind.Dictionary: {
        let props = (object as ClassObject).props;
        return _.template(readTemplate('dictionary'))({
          className: getClassName(blob),
          blob: blob,
          props: props,
          object: object,
          generateTypeConverter
        });
      }
      case TemplateKind.globalFunction: {
        object = object as FunctionObject;
        globalFunctionInstallList.push(` {"${object.declare.name}", ${object.declare.name}, ${object.declare.args.length}}`);
        return _.template(readTemplate('global_function'))({
          className: getClassName(blob),
          blob: blob,
          object: object,
          generateFunctionBody
        });
      }
    }
    return '';
  });

  return _.template(baseTemplate)({
    content: contents.join('\n'),
    className: getClassName(blob),
    blob: blob,
    globalFunctionInstallList,
    classPropsInstallList,
    classMethodsInstallList,
    wrapperTypeInfoInit
  });
}
