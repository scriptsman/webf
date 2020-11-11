/*
 * Copyright (C) 2020 Alibaba Inc. All rights reserved.
 * Author: Kraken Team.
 */

#include "comment_node.h"

namespace kraken::binding::jsc {

void bindCommentNode(std::unique_ptr<JSContext> &context) {
  auto commentNode = JSCommentNode::instance(context.get());
  JSC_GLOBAL_SET_PROPERTY(context, "CommentNode", commentNode->classObject);
}

JSCommentNode::JSCommentNode(JSContext *context) : JSNode(context, "CommentNode") {}
JSCommentNode *JSCommentNode::instance(JSContext *context) {
  static std::unordered_map<JSContext *, JSCommentNode*> instanceMap {};
  if (!instanceMap.contains(context)) {
    instanceMap[context] = new JSCommentNode(context);
  }
  return instanceMap[context];
}

JSObjectRef JSCommentNode::instanceConstructor(JSContextRef ctx, JSObjectRef constructor, size_t argumentCount,
                                               const JSValueRef *arguments, JSValueRef *exception) {

  auto textNode = new CommentNodeInstance(this);
  return textNode->object;
}

JSCommentNode::CommentNodeInstance::CommentNodeInstance(JSCommentNode *jsCommentNode)
  : NodeInstance(jsCommentNode, NodeType::COMMENT_NODE) {}

void JSCommentNode::CommentNodeInstance::setProperty(std::string &name, JSValueRef value, JSValueRef *exception) {
  NodeInstance::setProperty(name, value, exception);
  if (exception != nullptr) return;
}

JSValueRef JSCommentNode::CommentNodeInstance::getProperty(std::string &name, JSValueRef *exception) {
  if (name == "data") {
    return JSValueMakeString(_hostClass->ctx, data);
  } else if (name == "nodeName") {
    JSStringRef nodeName = JSStringCreateWithUTF8CString("#comment");
    return JSValueMakeString(_hostClass->ctx, nodeName);
  } else if (name == "length") {
    return JSValueMakeNumber(_hostClass->ctx, JSStringGetLength(data));
  }

  return NodeInstance::getProperty(name, exception);
}

void JSCommentNode::CommentNodeInstance::getPropertyNames(JSPropertyNameAccumulatorRef accumulator) {
  NodeInstance::getPropertyNames(accumulator);

  for (auto &property : getCommentPropertyNames()) {
    JSPropertyNameAccumulatorAddName(accumulator, property);
  }
}

std::array<JSStringRef, 2> &JSCommentNode::CommentNodeInstance::getCommentPropertyNames() {
  static std::array<JSStringRef, 2> propertyNames{
    JSStringCreateWithUTF8CString("data"),
    JSStringCreateWithUTF8CString("length"),
  };
  return propertyNames;
}

JSStringRef JSCommentNode::CommentNodeInstance::internalTextContent() {
  return data;
}
} // namespace kraken::binding::jsc
